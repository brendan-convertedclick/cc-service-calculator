// supabase/functions/notify-extension-request/index.ts
//
// Request:  POST { extension_request_id }
// Response: 200 { notified: string[], chat_ok: boolean }
//
// Best-effort notification fired right after a staff member submits a
// mid/large-tier (admin/owner) extension request: pings every team_members
// row with the matching role in ClickUp chat (with a real mention) and sends
// them an email. Auto-tier requests need no approval, so they're a no-op.
// Never blocks the requester's submit — swallow-and-log on every failure
// path (chat and email are independent; one failing doesn't sink the other).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { postChatMessage, mentionToken, CONVERTED_CLICK_CHANNEL_ID } from "../_shared/clickup-chat.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { sendGmail } from "../_shared/gmail.ts";

const APP_URL = "https://conductor.convertedclick.co.za";

type ExtensionRow = {
  id: string;
  tier: "auto" | "admin" | "owner";
  extra_points: number;
  reason: string;
  parent_task_name: string;
  requester_id: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { extension_request_id } = (await req.json()) as { extension_request_id?: string };
    if (!extension_request_id) return json({ error: "extension_request_id required" }, 400);

    const sb = createServiceRoleClient();

    const { data: rowRaw, error: rowErr } = await sb
      .from("extension_requests")
      .select("id, tier, extra_points, reason, parent_task_name, requester_id")
      .eq("id", extension_request_id)
      .single();
    if (rowErr || !rowRaw) return json({ error: rowErr?.message ?? "Not found" }, 404);
    const row = rowRaw as unknown as ExtensionRow;

    if (row.tier === "auto") return json({ notified: [], chat_ok: false, skipped: "auto-tier needs no approval" });

    const { data: requesterRaw } = await sb
      .from("team_members")
      .select("full_name")
      .eq("id", row.requester_id)
      .single();
    const requesterName = (requesterRaw as { full_name?: string } | null)?.full_name ?? "Someone";

    const { data: approversRaw } = await sb
      .from("team_members")
      .select("full_name, email, clickup_user_id")
      .eq("role", row.tier)
      .is("archived_at", null);
    const approvers = (approversRaw ?? []) as { full_name: string; email: string | null; clickup_user_id: number | null }[];
    if (approvers.length === 0) return json({ notified: [], chat_ok: false, warning: `No ${row.tier} on the team` });

    const queuePage = row.tier === "owner" ? "/escalations" : "/approvals";
    const summary = `+${row.extra_points}pt on "${row.parent_task_name}" — ${row.reason}`;

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
      CONVERTED_CLICK_CHANNEL_ID,
      `⏫ ${mentions} — extension request from ${requesterName} needs your approval (${row.tier} tier): ${summary}\n${APP_URL}${queuePage}`,
    );

    // Email: one outbound_emails row per approver (audit trail), sent immediately.
    const { data: settings } = await sb.from("settings").select("account_manager_email").eq("id", 1).single();
    const fromEmail =
      (settings as { account_manager_email?: string } | null)?.account_manager_email
      ?? "accountmanager@convertedclick.co.za";
    const accessToken = Deno.env.get("GOOGLE_ACCESS_TOKEN");

    const notified: string[] = [];
    for (const a of approvers) {
      if (!a.email) continue;
      const { data: outbound } = await sb.from("outbound_emails").insert({
        composed_by: row.requester_id,
        to_addresses: [a.email],
        subject: `Extension request needs your approval — ${row.parent_task_name}`,
        body_text:
          `${requesterName} requested +${row.extra_points} sprint points on "${row.parent_task_name}" (${row.tier} tier).\n\n` +
          `Reason: ${row.reason}\n\nReview: ${APP_URL}${queuePage}`,
        body_html:
          `<p>${requesterName} requested <b>+${row.extra_points}</b> sprint points on <b>${row.parent_task_name}</b> (${row.tier} tier).</p>` +
          `<p><b>Reason:</b> ${row.reason}</p><p><a href="${APP_URL}${queuePage}">Review in Conductor</a></p>`,
        status: "draft",
      }).select("id").single();
      if (!outbound?.id) continue;

      if (!accessToken) {
        await sb.from("outbound_emails").update({ status: "send_failed", send_error: "GOOGLE_ACCESS_TOKEN secret not set" }).eq("id", outbound.id);
        continue;
      }
      const sent = await sendGmail({
        accessToken,
        fromEmail,
        fromName: "Converted Click Account Manager",
        to: [a.email],
        subject: `Extension request needs your approval — ${row.parent_task_name}`,
        bodyText: `${requesterName} requested +${row.extra_points} sprint points on "${row.parent_task_name}" (${row.tier} tier).\n\nReason: ${row.reason}\n\nReview: ${APP_URL}${queuePage}`,
        bodyHtml: `<p>${requesterName} requested <b>+${row.extra_points}</b> sprint points on <b>${row.parent_task_name}</b> (${row.tier} tier).</p><p><b>Reason:</b> ${row.reason}</p><p><a href="${APP_URL}${queuePage}">Review in Conductor</a></p>`,
      });
      if (sent.ok) {
        await sb.from("outbound_emails").update({
          status: "sent", gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: new Date().toISOString(),
        }).eq("id", outbound.id);
        notified.push(a.email);
      } else {
        await sb.from("outbound_emails").update({ status: "send_failed", send_error: sent.error }).eq("id", outbound.id);
      }
    }

    return json({ notified, chat_ok: chatResult.ok, chat_error: chatResult.ok ? undefined : chatResult.error });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
