// supabase/functions/approve-extension-request/index.ts
//
// Request:  POST { extension_request_id: string }
// Response: 200 { clickup_subtask_id?, clickup_subtask_url?, due_date_applied? }
//
// Approves an extension request. Points and due-date asks are independent
// and a request may carry either or both:
//   - extra_points set      → creates a linked subtask in ClickUp under the
//                              parent task with the extra points + reason.
//   - requested_due_date set → PUTs the new due_date directly onto the parent
//                              task (no subtask) + an audit comment.
// Idempotent: re-approving an already-approved request is a no-op success.
//
// Two-stage: every request needing a human goes to the admin leg first. An
// admin approve on an owner-tier row *promotes* it to the owner queue
// (200 { promoted: true }) rather than pushing to ClickUp — the owner then
// approves again from /escalations. See _shared/extension-logic.ts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import {
  decideApprovalAction,
  type ExtensionStatus,
  type ExtensionTier,
  type MemberRole,
} from "../_shared/extension-logic.ts";

const POINT_TO_MIN = 15;

/** "YYYY-MM-DD" → ms epoch (UTC midnight), or null. */
function dateStrToMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(`${s}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

type ExtensionRow = {
  id: string;
  requester_id: string;
  client_id: string;
  parent_clickup_task_id: string;
  parent_task_name: string;
  extra_points: number | null;
  requested_due_date: string | null;
  due_date_reason: string | null;
  tier: ExtensionTier;
  reason: string | null;
  status: ExtensionStatus;
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
    const { data: callerRaw } = await supabase
      .from("team_members")
      .select("id, role, email")
      .eq("email", callerEmail)
      .maybeSingle();
    const caller = callerRaw as { id: string; role: MemberRole } | null;
    if (!caller?.role) return json({ error: "No team_members row for caller" }, 403);

    const { data: rowRaw, error: rowErr } = await supabase
      .from("extension_requests")
      .select("*")
      .eq("id", extension_request_id)
      .single();
    if (rowErr || !rowRaw) return json({ error: rowErr?.message ?? "Not found" }, 404);
    const row = rowRaw as unknown as ExtensionRow;

    const decision = decideApprovalAction(row, caller);
    if (decision.action === "denied") return json({ error: decision.reason }, 403);
    if (decision.action === "already_approved") {
      return json({
        clickup_subtask_id: row.clickup_subtask_id,
        clickup_subtask_url: row.clickup_subtask_url,
        already_approved: true,
      });
    }

    // Admin leg on an owner-tier row: hand it to the owner queue, touch nothing
    // in ClickUp. The owner approves again from /escalations.
    if (decision.action === "promote") {
      const { data: promoted, error: promoteErr } = await supabase
        .from("extension_requests")
        .update({
          status: "pending_owner",
          admin_approver_id: caller.id,
          admin_approved_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("id");
      if (promoteErr) return json({ error: promoteErr.message }, 500);
      // A zero-row update means RLS silently filtered it — never report success.
      if (!promoted || promoted.length === 0) {
        return json({ error: "Not permitted to promote this request" }, 403);
      }
      return json({ promoted: true, status: "pending_owner" });
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

    let created: { id: string; url: string } | null = null;

    if (row.extra_points) {
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
      created = (await createRes.json()) as { id: string; url: string };

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
    }

    if (row.requested_due_date) {
      const dueMs = dateStrToMs(row.requested_due_date);
      if (dueMs === null) {
        return json({ error: `Invalid requested_due_date: ${row.requested_due_date}` }, 500);
      }

      // No subtask for a due-date push — PUT it straight onto the parent task.
      const dueRes = await fetch(
        `https://api.clickup.com/api/v2/task/${row.parent_clickup_task_id}`,
        { ...CU, method: "PUT", body: JSON.stringify({ due_date: dueMs, due_date_time: false }) },
      );
      if (!dueRes.ok) {
        return json({ error: `ClickUp due-date update ${dueRes.status}: ${await dueRes.text()}` }, 502);
      }

      // Audit comment on the parent, mirroring EXTENSION::.
      await fetch(`https://api.clickup.com/api/v2/task/${row.parent_clickup_task_id}/comment`, {
        ...CU,
        method: "POST",
        body: JSON.stringify({
          comment_text:
            `DUE_DATE_EXTENSION:: ${JSON.stringify({
              extension_request_id: row.id,
              requested_due_date: row.requested_due_date,
              due_date_reason: row.due_date_reason,
              tier: row.tier,
              approved_by: callerEmail,
            })}`,
          notify_all: false,
        }),
      });
    }

    const { data: finalised, error: updateErr } = await supabase
      .from("extension_requests")
      .update({
        status: "approved",
        approver_id: caller.id,
        approved_at: new Date().toISOString(),
        ...(created ? { clickup_subtask_id: created.id, clickup_subtask_url: created.url } : {}),
      })
      .eq("id", row.id)
      .select("id");
    if (updateErr || !finalised || finalised.length === 0) {
      return json({
        error: `ClickUp updated but DB update failed: ${updateErr?.message ?? "blocked by RLS"}`,
        clickup_subtask_id: created?.id,
        clickup_subtask_url: created?.url,
      }, 500);
    }

    return json({
      clickup_subtask_id: created?.id,
      clickup_subtask_url: created?.url,
      due_date_applied: row.requested_due_date ?? undefined,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
