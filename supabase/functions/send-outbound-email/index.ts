// supabase/functions/send-outbound-email/index.ts
//
// Request:  POST { outbound_email_id: string }
// Response: 200 { gmail_message_id, gmail_thread_id }
//
// Sends a previously composed outbound email via the Gmail API AS THE SIGNED-IN
// PERSON — lisa@ sends from lisa@ — so replies come back to whoever actually
// wrote it and the trail is a real person rather than a shared mailbox.
//
// Auth model:
//   - Caller must be admin or owner.
//   - The Gmail access token is minted from that person's own Google refresh
//     token, the one already captured by the Supabase Auth Google sign-in
//     (_shared/google-token.ts, same path the calendar integration uses).
//     There is no pasted GOOGLE_ACCESS_TOKEN secret any more: it was a manual
//     access token that expired an hour after being set, which is why every
//     send failed.
//
// The operator fallback in getGoogleAccessToken is deliberately REFUSED here.
// For a calendar event, falling back to the earliest-connected account is a
// convenience; for email it would put one person's name on another person's
// message. If the sender has no grant of their own, the send fails and says so.
//
// Prerequisite: the Google OAuth consent screen must carry
// https://www.googleapis.com/auth/gmail.send, and each person must have signed
// in with Google since it was added. No Send-as alias or Workspace setup is
// needed — everyone sends as themselves.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient, createServiceRoleClient } from "../_shared/supabase-client.ts";
import { sendGmail } from "../_shared/gmail.ts";
import { getGoogleAccessToken } from "../_shared/google-token.ts";

type OutboundRow = {
  id: string;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string;
  body_html: string;
  body_text: string;
  gmail_thread_id: string | null;
  status: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { outbound_email_id } = (await req.json()) as { outbound_email_id?: string };
    if (!outbound_email_id) return json({ error: "outbound_email_id required" }, 400);

    const user = createUserClient(req);
    const callerEmail = (await user.auth.getUser()).data.user?.email ?? "";
    const { data: caller } = await user
      .from("team_members")
      .select("id, role, full_name, email_signature, email_signature_html")
      .eq("email", callerEmail)
      .maybeSingle();
    const role = (caller as { role?: string } | null)?.role;
    if (role !== "admin" && role !== "owner") {
      return json({ error: "Admin or owner role required" }, 403);
    }

    const sb = createServiceRoleClient();
    const { data: rowRaw, error: rowErr } = await sb
      .from("outbound_emails")
      .select("*")
      .eq("id", outbound_email_id)
      .single();
    if (rowErr || !rowRaw) return json({ error: rowErr?.message ?? "Not found" }, 404);
    const row = rowRaw as unknown as OutboundRow;

    if (row.status === "sent") return json({ already_sent: true });

    const grant = await getGoogleAccessToken(req);
    // via !== "member" means this token belongs to someone else (the operator
    // fallback). Sending under it would sign this person's email with another
    // person's address — refuse rather than misattribute.
    const failure =
      grant.accessToken == null
        ? grant.error ?? "No Google account connected."
        : grant.via !== "member"
          ? `No Google account connected for ${callerEmail} — sign out and sign in with Google to send as yourself.`
          : null;
    if (failure) {
      await sb
        .from("outbound_emails")
        .update({ status: "send_failed", send_error: failure })
        .eq("id", row.id);
      return json({ error: failure }, 400);
    }

    // Appended here rather than pasted into each template or into the compose
    // box: one definition per person, and it cannot go stale in fifteen copies.
    // Gmail never adds one — its signature belongs to the web and phone
    // clients, so anything sent through the API arrives bare without this.
    const me = caller as { email_signature?: string | null; email_signature_html?: string | null } | null;
    const sigText = me?.email_signature?.trim() ?? "";
    const sigHtml = me?.email_signature_html?.trim() ?? "";

    // The text part never takes HTML. If someone has only uploaded an HTML
    // signature, strip it back to something readable rather than posting tags
    // into a plain-text email.
    const textFallback = sigText || (sigHtml
      ? sigHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim()
      : "");

    const bodyText = textFallback ? `${row.body_text}\n\n--\n${textFallback}` : row.body_text;
    const bodyHtml = sigHtml
      ? `${row.body_html}\n<br>--<br>\n${sigHtml}`
      : sigText
        ? `${row.body_html}\n<p>--<br>${sigText
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>")}</p>`
        : row.body_html;

    const sent = await sendGmail({
      accessToken: grant.accessToken!,
      fromEmail: grant.googleEmail ?? callerEmail,
      fromName: (caller as { full_name?: string } | null)?.full_name ?? "Converted Click",
      to: row.to_addresses,
      cc: row.cc_addresses,
      bcc: row.bcc_addresses,
      subject: row.subject,
      bodyHtml,
      bodyText,
      threadId: row.gmail_thread_id,
    });
    if (!sent.ok) {
      await sb
        .from("outbound_emails")
        .update({ status: "send_failed", send_error: sent.error })
        .eq("id", row.id);
      return json({ error: `Gmail send failed: ${sent.error}` }, 502);
    }

    await sb
      .from("outbound_emails")
      .update({
        status: "sent",
        gmail_message_id: sent.id,
        gmail_thread_id: sent.threadId,
        sent_at: new Date().toISOString(),
        send_error: null,
      })
      .eq("id", row.id);

    return json({ gmail_message_id: sent.id, gmail_thread_id: sent.threadId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
