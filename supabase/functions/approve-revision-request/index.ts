// supabase/functions/approve-revision-request/index.ts
//
// Request:  POST { revision_request_id: string }
// Response: 200 { clickup_new_task_id, clickup_new_task_url }
//
// Approves a revision request: creates a NEW ClickUp task in the same list
// as the parent, with the same base name but the requested DFT/REV suffix
// swapped in (or appended, if the parent name has none), cloning the
// parent's assignees + custom field values. Posts a REVISION:: audit comment
// on the parent. Idempotent: re-approving an already-approved request is a
// no-op success. Always admin-tier — admin or owner caller only.

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
    const created = (await createRes.json()) as { id: string; url: string };

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
