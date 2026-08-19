// supabase/functions/notify-extension-request/index.ts
//
// Request:  POST { extension_request_id }
// Response: 200 { notified: string[], chat_ok: boolean }
//
// Best-effort notification for whoever currently owes a decision. The
// audience is derived from `status`, never `tier` — a fresh owner-tier request
// sits at `pending_admin`, so it pings the admin leg (Lisa), not the owner.
// Re-fire it after each transition:
//   pending_admin → admins   (/approvals)
//   pending_owner → owner    (/escalations)  — only reached post admin sign-off
//   needs_info    → the requester (/staff), with the approver's question
// Anything else is a no-op. Never blocks the requester's submit — chat and
// email are independent; one failing doesn't sink the other.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { postChatMessage, mentionToken, approvalsChannel, CONVERTED_CLICK_CHANNEL_ID } from "../_shared/clickup-chat.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { sendNotificationEmails } from "../_shared/gmail.ts";

const APP_URL = "https://conductor.convertedclick.co.za";

type ExtensionRow = {
  id: string;
  tier: "auto" | "admin" | "owner";
  status: string;
  extra_points: number | null;
  reason: string | null;
  requested_due_date: string | null;
  due_date_reason: string | null;
  info_request: string | null;
  parent_task_name: string;
  requester_id: string;
  client_id: string;
};

/** Plain-text summary of whichever of points/due-date this request carries. */
function buildSummary(row: ExtensionRow): string {
  const parts: string[] = [];
  if (row.extra_points) parts.push(`+${row.extra_points}pt — ${row.reason}`);
  if (row.requested_due_date) parts.push(`due date → ${row.requested_due_date} — ${row.due_date_reason}`);
  return `"${row.parent_task_name}": ${parts.join(" · ")}`;
}

type Target =
  | { kind: "role"; role: "admin" | "owner"; queuePage: string }
  | { kind: "requester"; queuePage: string };

/** Who owes the next decision, from `status` alone. Null = nothing to send. */
function notifyTarget(row: ExtensionRow): Target | null {
  if (row.status === "pending_admin") return { kind: "role", role: "admin", queuePage: "/approvals" };
  if (row.status === "pending_owner") return { kind: "role", role: "owner", queuePage: "/escalations" };
  if (row.status === "needs_info") return { kind: "requester", queuePage: "/staff" };
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { extension_request_id } = (await req.json()) as { extension_request_id?: string };
    if (!extension_request_id) return json({ error: "extension_request_id required" }, 400);

    const sb = createServiceRoleClient();

    const { data: rowRaw, error: rowErr } = await sb
      .from("extension_requests")
      .select(
        "id, tier, status, extra_points, reason, requested_due_date, due_date_reason, info_request, parent_task_name, requester_id, client_id",
      )
      .eq("id", extension_request_id)
      .single();
    if (rowErr || !rowRaw) return json({ error: rowErr?.message ?? "Not found" }, 404);
    const row = rowRaw as unknown as ExtensionRow;

    const target = notifyTarget(row);
    if (!target) {
      return json({ notified: [], chat_ok: false, skipped: `status=${row.status} needs no notification` });
    }

    const { data: requesterRaw } = await sb
      .from("team_members")
      .select("full_name")
      .eq("id", row.requester_id)
      .single();
    const requesterName = (requesterRaw as { full_name?: string } | null)?.full_name ?? "Someone";

    const recipientQuery = sb.from("team_members").select("full_name, email, clickup_user_id");
    const { data: approversRaw } = await (target.kind === "role"
      ? recipientQuery.eq("role", target.role).is("archived_at", null)
      : recipientQuery.eq("id", row.requester_id));
    const approvers = (approversRaw ?? []) as { full_name: string; email: string | null; clickup_user_id: number | null }[];
    if (approvers.length === 0) {
      const who = target.kind === "role" ? `No ${target.role} on the team` : "Requester not found";
      return json({ notified: [], chat_ok: false, warning: who });
    }

    const queuePage = target.queuePage;
    const summary = buildSummary(row);

    // One lead line per audience — the owner leg is only ever reached after
    // the admin has signed off, so say so.
    const lead =
      target.kind === "requester"
        ? `❓ more information needed on your extension request: ${summary}\nQuestion: ${row.info_request ?? "—"}`
        : target.role === "owner"
          ? `⏫ admin-approved extension escalated for owner sign-off (${row.tier} tier), raised by ${requesterName}: ${summary}`
          : `⏫ extension request from ${requesterName} needs your approval (${row.tier} tier): ${summary}`;
    const subject =
      target.kind === "requester"
        ? `More information needed — ${row.parent_task_name}`
        : `Extension request needs your approval — ${row.parent_task_name}`;

    // Same routing as brief notifications: post in the client's own channel,
    // falling back to Converted Click only if none is mapped.
    const { data: clientRaw } = await sb
      .from("clients")
      .select("clickup_chat_channel_id")
      .eq("id", row.client_id)
      .single();
    const chatChannelId = approvalsChannel(
      (clientRaw as { clickup_chat_channel_id?: string } | null)?.clickup_chat_channel_id
      ?? CONVERTED_CLICK_CHANNEL_ID,
    );

    // ClickUp chat: one message, mention every approver so it actually pings them.
    // Post as the requester's own ClickUp identity when they've connected one
    // (getOperatorClickupToken), so it doesn't always show up as Brendan —
    // falls back to the shared CLICKUP_PAT if they haven't.
    const { token: clickupPat } = await getOperatorClickupToken(req);
    const mentions = approvers
      .map((a) => mentionToken({ clickupUserId: a.clickup_user_id, name: a.full_name }))
      .join(" ");
    const chatResult = await postChatMessage(
      clickupPat,
      chatChannelId,
      `${mentions} — ${lead}\n${APP_URL}${queuePage}`,
    );

    // Email: one outbound_emails row per approver (audit trail), sent immediately.
    const notified = await sendNotificationEmails({
      req,
      sb,
      composedBy: row.requester_id,
      recipientEmails: approvers.map((a) => a.email),
      subject: subject,
      bodyText: `${lead}\n\nReview: ${APP_URL}${queuePage}`,
      bodyHtml: `<p>${lead.replace(/\n/g, "<br>")}</p><p><a href="${APP_URL}${queuePage}">Review in Conductor</a></p>`,
    });

    return json({ notified, chat_ok: chatResult.ok, chat_error: chatResult.ok ? undefined : chatResult.error });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
