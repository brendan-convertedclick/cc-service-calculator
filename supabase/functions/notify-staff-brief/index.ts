// supabase/functions/notify-staff-brief/index.ts
//
// Request:  POST { staff_brief_id }
// Response: 200 { notified: string[], chat_ok: boolean }
//
// Best-effort notification fired right after a staff member submits a New
// Brief: pings every admin in ClickUp chat (with a real mention) and sends
// them an email. Always fires — staff briefs have no auto-tier, every one
// needs admin (or owner) approval. Never blocks the requester's submit —
// swallow-and-log on every failure path (chat and email are independent;
// one failing doesn't sink the other). Mirrors notify-revision-request.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { postChatMessage, mentionToken, approvalsChannel, CONVERTED_CLICK_CHANNEL_ID } from "../_shared/clickup-chat.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { sendGmail } from "../_shared/gmail.ts";

const APP_URL = "https://conductor.convertedclick.co.za";

type StaffBriefRow = {
  id: string;
  task_name: string;
  sprint_points: number;
  is_internal: boolean;
  submitter_id: string;
  client_id: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { staff_brief_id } = (await req.json()) as { staff_brief_id?: string };
    if (!staff_brief_id) return json({ error: "staff_brief_id required" }, 400);

    const sb = createServiceRoleClient();

    const { data: rowRaw, error: rowErr } = await sb
      .from("staff_briefs")
      .select("id, task_name, sprint_points, is_internal, submitter_id, client_id")
      .eq("id", staff_brief_id)
      .single();
    if (rowErr || !rowRaw) return json({ error: rowErr?.message ?? "Not found" }, 404);
    const row = rowRaw as unknown as StaffBriefRow;

    const { data: submitterRaw } = await sb
      .from("team_members")
      .select("full_name")
      .eq("id", row.submitter_id)
      .single();
    const submitterName = (submitterRaw as { full_name?: string } | null)?.full_name ?? "Someone";

    const { data: approversRaw } = await sb
      .from("team_members")
      .select("full_name, email, clickup_user_id")
      .eq("role", "admin")
      .is("archived_at", null);
    const approvers = (approversRaw ?? []) as { full_name: string; email: string | null; clickup_user_id: number | null }[];
    if (approvers.length === 0) return json({ notified: [], chat_ok: false, warning: "No admin on the team" });

    const summary = `"${row.task_name}" · ${row.sprint_points}pt${row.is_internal ? " · internal" : ""}`;

    // Same routing as brief/extension/revision notifications: post in the
    // client's own channel, falling back to Converted Click only if none is mapped.
    const { data: clientRaw } = await sb
      .from("clients")
      .select("clickup_chat_channel_id")
      .eq("id", row.client_id)
      .single();
    const chatChannelId = approvalsChannel(
      (clientRaw as { clickup_chat_channel_id?: string } | null)?.clickup_chat_channel_id
      ?? CONVERTED_CLICK_CHANNEL_ID,
    );

    const { token: clickupPat } = await getOperatorClickupToken(req);
    const mentions = approvers
      .map((a) => mentionToken({ clickupUserId: a.clickup_user_id, name: a.full_name }))
      .join(" ");
    const chatResult = await postChatMessage(
      clickupPat,
      chatChannelId,
      `📝 ${mentions} — new brief from ${submitterName} needs your approval: ${summary}\n${APP_URL}/approvals`,
    );

    const { data: settings } = await sb.from("settings").select("account_manager_email").eq("id", 1).single();
    const fromEmail =
      (settings as { account_manager_email?: string } | null)?.account_manager_email
      ?? "accountmanager@convertedclick.co.za";
    const accessToken = Deno.env.get("GOOGLE_ACCESS_TOKEN");

    const notified: string[] = [];
    for (const a of approvers) {
      if (!a.email) continue;
      const { data: outbound } = await sb.from("outbound_emails").insert({
        composed_by: row.submitter_id,
        to_addresses: [a.email],
        subject: `Brief needs your approval — ${row.task_name}`,
        body_text:
          `${submitterName} submitted a new brief: ${summary}\n\nReview: ${APP_URL}/approvals`,
        body_html:
          `<p>${submitterName} submitted a new brief: ${summary}</p>` +
          `<p><a href="${APP_URL}/approvals">Review in Conductor</a></p>`,
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
        subject: `Brief needs your approval — ${row.task_name}`,
        bodyText: `${submitterName} submitted a new brief: ${summary}\n\nReview: ${APP_URL}/approvals`,
        bodyHtml: `<p>${submitterName} submitted a new brief: ${summary}</p><p><a href="${APP_URL}/approvals">Review in Conductor</a></p>`,
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
