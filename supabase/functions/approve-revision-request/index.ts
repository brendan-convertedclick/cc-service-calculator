// supabase/functions/approve-revision-request/index.ts
//
// Request:  POST { revision_request_id: string }
// Response: 200 { clickup_new_task_id, clickup_new_task_url }
//
// Approves a revision request: creates a NEW ClickUp task in the same list
// as the parent, with the same base name but the requested DFT/REV suffix
// swapped in (or appended, if the parent name has none), cloning the
// parent's assignees + custom field values. Always admin-tier — admin or
// owner caller only.
//
// A draft is never allowed to exist unlinked from the task it revises. Three
// separate traces, cheapest-to-lose last:
//   1. the new task's own description — written atomically with the create,
//      so it cannot fail on its own;
//   2. a native ClickUp task link, which is what a human actually sees in the
//      UI on BOTH tasks;
//   3. a REVISION:: audit comment on the parent.
// The row is only marked `approved` once (1) and (2) are both in place. If
// linking fails the task id is already persisted, so re-approving resumes at
// the link step instead of creating a duplicate draft.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { swapRevisionSuffix } from "../_shared/revision-logic.ts";

type RevisionRow = {
  id: string;
  requester_id: string;
  client_id: string;
  parent_clickup_task_id: string;
  parent_task_name: string;
  revision_suffix: string;
  status: string;
  clickup_new_task_id: string | null;
  clickup_new_task_url: string | null;
};

type CuCustomField = { id: string; value?: unknown };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { revision_request_id } = (await req.json()) as { revision_request_id?: string };
    if (!revision_request_id) return json({ error: "revision_request_id required" }, 400);

    const supabase = createUserClient(req);
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const callerEmail = (await supabase.auth.getUser()).data.user?.email ?? "";
    const { data: caller } = await supabase
      .from("team_members")
      .select("id, role")
      .eq("email", callerEmail)
      .maybeSingle();
    const callerRole = (caller as { role?: string } | null)?.role;
    if (!callerRole) return json({ error: "No team_members row for caller" }, 403);
    if (callerRole !== "admin" && callerRole !== "owner") {
      return json({ error: "Admin or owner role required" }, 403);
    }

    const { data: rowRaw, error: rowErr } = await supabase
      .from("revision_requests")
      .select("*")
      .eq("id", revision_request_id)
      .single();
    if (rowErr || !rowRaw) return json({ error: rowErr?.message ?? "Not found" }, 404);
    const row = rowRaw as unknown as RevisionRow;

    if (row.status === "approved") {
      return json({
        clickup_new_task_id: row.clickup_new_task_id,
        clickup_new_task_url: row.clickup_new_task_url,
        already_approved: true,
      });
    }
    if (row.status === "rejected") {
      return json({ error: "Revision already rejected" }, 400);
    }

    const CU = {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    };

    const parentRes = await fetch(
      `https://api.clickup.com/api/v2/task/${row.parent_clickup_task_id}`,
      CU,
    );
    if (!parentRes.ok) {
      return json({ error: `ClickUp parent ${parentRes.status}: ${await parentRes.text()}` }, 502);
    }
    const parent = (await parentRes.json()) as {
      name: string;
      list?: { id: string };
      assignees?: Array<{ id: number }>;
      custom_fields?: CuCustomField[];
    };
    const parentListId = parent.list?.id;
    if (!parentListId) return json({ error: "Parent task has no list" }, 502);

    const parentUrl = `https://app.clickup.com/t/${row.parent_clickup_task_id}`;

    // Resume: a previous attempt created the task but didn't get as far as
    // linking it. Pick that task back up rather than creating a second draft.
    let created: { id: string; url: string };
    if (row.clickup_new_task_id) {
      created = {
        id: row.clickup_new_task_id,
        url: row.clickup_new_task_url ?? `https://app.clickup.com/t/${row.clickup_new_task_id}`,
      };
    } else {
      const newName = swapRevisionSuffix(parent.name, row.revision_suffix);
      const customFields = (parent.custom_fields ?? [])
        .filter((f) => f.value !== null && f.value !== undefined)
        .map((f) => {
          const v = f.value as unknown;
          const value = typeof v === "object" && v !== null && "id" in v ? (v as { id: unknown }).id : v;
          return { id: f.id, value };
        });

      const createBody: Record<string, unknown> = {
        name: newName,
        // Written with the create so the draft is never readable without its
        // origin, even if the task-link call below fails.
        description:
          `Revision of [${parent.name}](${parentUrl}) → ${row.revision_suffix}\n\n---\n` +
          `REVISION:: ${JSON.stringify({
            revision_request_id: row.id,
            parent_task_id: row.parent_clickup_task_id,
          })}`,
        // Omit `status` — let ClickUp use the list's default (custom status
        // sets make hardcoding a value fail with CRTSK_001).
        custom_fields: customFields,
      };
      if (parent.assignees?.length) {
        createBody.assignees = parent.assignees.map((a) => a.id);
      }

      const createRes = await fetch(
        `https://api.clickup.com/api/v2/list/${parentListId}/task`,
        { ...CU, method: "POST", body: JSON.stringify(createBody) },
      );
      if (!createRes.ok) {
        return json({ error: `ClickUp create ${createRes.status}: ${await createRes.text()}` }, 502);
      }
      created = (await createRes.json()) as { id: string; url: string };

      // Persist BEFORE linking, leaving status at pending_admin. If the link
      // call fails, the id survives and the retry resumes above instead of
      // orphaning this task and creating another. supabase-js reports a
      // no-op success when RLS filters every row, so a zero-row result here
      // is fatal — without the id the retry would create a duplicate draft.
      const { data: stamped, error: stampErr } = await supabase
        .from("revision_requests")
        .update({ clickup_new_task_id: created.id, clickup_new_task_url: created.url })
        .eq("id", row.id)
        .select("id");
      if (stampErr || !stamped || stamped.length === 0) {
        return json({
          error: `Draft ${created.id} created but could not be recorded against the request` +
            `${stampErr ? `: ${stampErr.message}` : " (no row updated)"}. ` +
            `Link it to ${parentUrl} by hand — re-approving would create a second draft.`,
          clickup_new_task_id: created.id,
          clickup_new_task_url: created.url,
        }, 500);
      }
    }

    // The link a human sees — shows on both tasks under "Linked tasks".
    // Hard requirement: no draft is approved without it.
    const linkRes = await fetch(
      `https://api.clickup.com/api/v2/task/${created.id}/link/${row.parent_clickup_task_id}`,
      // Endpoint takes no payload, but CU declares a JSON content-type — send
      // an empty object so the request is well-formed rather than a
      // zero-byte body labelled as JSON.
      { ...CU, method: "POST", body: "{}" },
    );
    if (!linkRes.ok) {
      return json({
        error: `Draft ${created.id} created but could not be linked to the parent ` +
          `(ClickUp ${linkRes.status}: ${await linkRes.text()}). Left unapproved — ` +
          `approve again to retry the link.`,
        clickup_new_task_id: created.id,
        clickup_new_task_url: created.url,
      }, 502);
    }

    // Audit comment on the parent, mirroring EXTENSION::.
    await fetch(`https://api.clickup.com/api/v2/task/${row.parent_clickup_task_id}/comment`, {
      ...CU,
      method: "POST",
      body: JSON.stringify({
        comment_text:
          `REVISION:: ${JSON.stringify({
            revision_request_id: row.id,
            revision_suffix: row.revision_suffix,
            new_task_id: created.id,
            approved_by: callerEmail,
          })}`,
        notify_all: false,
      }),
    });

    const { error: updateErr } = await supabase
      .from("revision_requests")
      .update({
        status: "approved",
        approver_id: (caller as { id: string }).id,
        approved_at: new Date().toISOString(),
        clickup_new_task_id: created.id,
        clickup_new_task_url: created.url,
      })
      .eq("id", row.id);
    if (updateErr) {
      return json({
        error: `Task ${created.id} created but DB update failed: ${updateErr.message}`,
        clickup_new_task_id: created.id,
        clickup_new_task_url: created.url,
      }, 500);
    }

    return json({ clickup_new_task_id: created.id, clickup_new_task_url: created.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
