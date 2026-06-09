// supabase/functions/approve-extension-request/index.ts
//
// Request:  POST { extension_request_id: string }
// Response: 200 { clickup_subtask_id, clickup_subtask_url }
//
// Approves an extension request and creates a linked subtask in ClickUp
// under the parent task with the extra sprint points + reason.
// Idempotent: re-approving a request with an existing subtask is a no-op
// success. Role-gated by tier:
//   - tier=auto      → any caller can finalise (callable internally on insert)
//   - tier=admin     → admin or owner caller
//   - tier=owner     → owner caller only

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

const POINT_TO_MIN = 15;

type ExtensionRow = {
  id: string;
  requester_id: string;
  client_id: string;
  parent_clickup_task_id: string;
  parent_task_name: string;
  extra_points: number;
  tier: "auto" | "admin" | "owner";
  reason: string;
  status: string;
  clickup_subtask_id: string | null;
  clickup_subtask_url: string | null;
};

type Member = {
  id: string;
  full_name: string;
  email: string | null;
  clickup_user_id: number | null;
  role: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { extension_request_id } = (await req.json()) as { extension_request_id?: string };
    if (!extension_request_id) return json({ error: "extension_request_id required" }, 400);

    const supabase = createUserClient(req);
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const callerEmail = (await supabase.auth.getUser()).data.user?.email ?? "";
    const { data: caller } = await supabase
      .from("team_members")
      .select("id, role, email")
      .eq("email", callerEmail)
      .maybeSingle();
    const callerRole = (caller as { role?: string } | null)?.role;
    if (!callerRole) return json({ error: "No team_members row for caller" }, 403);

    const { data: rowRaw, error: rowErr } = await supabase
      .from("extension_requests")
      .select("*")
      .eq("id", extension_request_id)
      .single();
    if (rowErr || !rowRaw) return json({ error: rowErr?.message ?? "Not found" }, 404);
    const row = rowRaw as unknown as ExtensionRow;

    // Role gating by tier
    if (row.tier === "owner" && callerRole !== "owner") {
      return json({ error: "Owner role required for this extension" }, 403);
    }
    if (row.tier === "admin" && callerRole !== "admin" && callerRole !== "owner") {
      return json({ error: "Admin or owner role required" }, 403);
    }
    // tier=auto can be finalised by anyone with at least admin rights (RLS already gates inserts to self)
    if (row.tier === "auto" && callerRole === "staff") {
      // Staff can only finalise their own auto-approved row.
      if (row.requester_id !== (caller as { id: string }).id) {
        return json({ error: "Not your row" }, 403);
      }
    }

    if (row.clickup_subtask_id) {
      return json({
        clickup_subtask_id: row.clickup_subtask_id,
        clickup_subtask_url: row.clickup_subtask_url,
        already_approved: true,
      });
    }
    if (row.status === "rejected") {
      return json({ error: "Extension already rejected" }, 400);
    }

    const { data: requester, error: reqErr } = await supabase
      .from("team_members")
      .select("id, full_name, email, clickup_user_id, role")
      .eq("id", row.requester_id)
      .single();
    if (reqErr || !requester) return json({ error: "Requester not found" }, 400);
    const member = requester as unknown as Member;

    const CU = {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    };

    const subtaskBody: Record<string, unknown> = {
      name: `[Extension] ${row.parent_task_name} — +${row.extra_points}pt`,
      description:
        `**Extension request**\n\n${row.reason}\n\n---\n` +
        `_+${row.extra_points} pts · tier=${row.tier} · approved by ${callerEmail}_\n` +
        `EXTENSION:: ${row.id}`,
      // Omit `status` — let ClickUp use the list's default. Client spaces use
      // custom status sets, so hardcoding "to do" fails with CRTSK_001.
      parent: row.parent_clickup_task_id,
      time_estimate: Math.round(row.extra_points * POINT_TO_MIN * 60_000),
    };
    if (member.clickup_user_id) {
      subtaskBody.assignees = [member.clickup_user_id];
    }

    // Subtasks are created on the parent's list. Need the parent's list_id.
    const parentRes = await fetch(
      `https://api.clickup.com/api/v2/task/${row.parent_clickup_task_id}`,
      CU,
    );
    if (!parentRes.ok) {
      return json({ error: `ClickUp parent ${parentRes.status}: ${await parentRes.text()}` }, 502);
    }
    const parent = (await parentRes.json()) as { list?: { id: string } };
    const parentListId = parent.list?.id;
    if (!parentListId) return json({ error: "Parent task has no list" }, 502);

    const createRes = await fetch(
      `https://api.clickup.com/api/v2/list/${parentListId}/task`,
      { ...CU, method: "POST", body: JSON.stringify(subtaskBody) },
    );
    if (!createRes.ok) {
      return json({ error: `ClickUp create ${createRes.status}: ${await createRes.text()}` }, 502);
    }
    const created = (await createRes.json()) as { id: string; url: string };

    // Audit comment on the parent.
    await fetch(`https://api.clickup.com/api/v2/task/${row.parent_clickup_task_id}/comment`, {
      ...CU,
      method: "POST",
      body: JSON.stringify({
        comment_text:
          `EXTENSION:: ${JSON.stringify({
            extension_request_id: row.id,
            extra_points: row.extra_points,
            tier: row.tier,
            subtask_id: created.id,
          })}`,
        notify_all: false,
      }),
    });

    const { error: updateErr } = await supabase
      .from("extension_requests")
      .update({
        status: "approved",
        approver_id: (caller as { id: string }).id,
        approved_at: new Date().toISOString(),
        clickup_subtask_id: created.id,
        clickup_subtask_url: created.url,
      })
      .eq("id", row.id);
    if (updateErr) {
      return json({
        error: `Subtask ${created.id} created but DB update failed: ${updateErr.message}`,
        clickup_subtask_id: created.id,
        clickup_subtask_url: created.url,
      }, 500);
    }

    return json({ clickup_subtask_id: created.id, clickup_subtask_url: created.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
