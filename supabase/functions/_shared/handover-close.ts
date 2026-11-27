// supabase/functions/_shared/handover-close.ts
//
// The other half of a hand-over (0204): when the client decides on a sign-off
// that handover-signoffs drafted, ClickUp follows.
//   approved           → the task moves to its list's closed status, which is
//                        what stops its clock and locks its time into the
//                        retainer on the next sync-clickup-actuals run.
//   changes_requested  → their note goes on the task as a comment, and the
//                        task goes back to in progress for whoever did it.
//
// Rows a person drafted by hand (handed_over_at null) are left alone: those
// predate this flow and their tasks are moved by people.
//
// Never throws. It runs after the decision is saved, and a ClickUp outage must
// not turn a client's approval into an error on their screen.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { cuFetch } from "./clickup.ts";
import { bounceStatus, CONDUCTOR_MARK } from "./handover.ts";

const CU = "https://api.clickup.com/api/v2";

export async function closeHandoverLoop(
  sb: SupabaseClient,
  approvalId: string,
  decision: "approved" | "changes_requested",
  deciderName: string,
  note: string,
): Promise<void> {
  try {
    const pat = Deno.env.get("CLICKUP_PAT") ?? "";
    if (!pat) return;
    const { data } = await sb
      .from("client_approvals")
      .select("handed_over_at, briefs(clickup_task_id)")
      .eq("id", approvalId)
      .maybeSingle();
    const row = data as
      | { handed_over_at: string | null; briefs: { clickup_task_id: string | null } | { clickup_task_id: string | null }[] | null }
      | null;
    const brief = Array.isArray(row?.briefs) ? row?.briefs[0] : row?.briefs;
    const taskId = brief?.clickup_task_id;
    if (!row?.handed_over_at || !taskId) return;

    const headers = { Authorization: pat, "Content-Type": "application/json" };
    const task = await (await cuFetch(`${CU}/task/${encodeURIComponent(taskId)}`, { headers })).json() as {
      list?: { id?: string };
    };
    const list = task.list?.id
      ? await (await cuFetch(`${CU}/list/${task.list.id}`, { headers })).json() as {
        statuses?: { status: string; type?: string; orderindex?: number }[];
      }
      : { statuses: [] };
    const statuses = list.statuses ?? [];
    const target = decision === "approved"
      ? statuses.find((s) => s.type === "closed")?.status ?? "complete"
      : bounceStatus(statuses);

    const comment = decision === "approved"
      ? `${CONDUCTOR_MARK}: ${deciderName} approved this on their sign-off page.${note ? `\n\n> ${note}` : ""}`
      : `${CONDUCTOR_MARK}: ${deciderName} asked for changes on their sign-off page:\n\n> ${note.split("\n").join("\n> ")}\n\nWhen it's done, leave a new closing comment and move it to "send to client" again.`;
    await cuFetch(`${CU}/task/${encodeURIComponent(taskId)}/comment`, {
      method: "POST",
      headers,
      body: JSON.stringify({ comment_text: comment, notify_all: decision === "changes_requested" }),
    });
    if (target) {
      await cuFetch(`${CU}/task/${encodeURIComponent(taskId)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status: target }),
      });
    }
  } catch (e) {
    console.error("[handover-close] failed:", e instanceof Error ? e.message : e);
  }
}
