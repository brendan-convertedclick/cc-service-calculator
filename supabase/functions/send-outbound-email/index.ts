// supabase/functions/send-outbound-email/index.ts
//
// Request:  POST { outbound_email_id: string }
// Response: 200 { gmail_message_id, gmail_thread_id }
//
// Sends a previously composed outbound email via the Gmail API using the
// account-manager Send-as alias on Brendan's Workspace identity.
//
// Auth model:
//   - Caller must be admin or owner.
//   - The Gmail OAuth access token is read from the GOOGLE_ACCESS_TOKEN
//     edge secret. Operator runs the one-time OAuth flow externally (or
//     via a future Settings page wiring) and pastes the access token into
//     Supabase secrets. Refresh-token rotation is a follow-up.
//
// Workspace prerequisite (manual, one-time):
//   1. Add `accountmanager@convertedclick.co.za` as a Send-as alias on
//      Brendan's Google Workspace account.
//   2. Verify the alias (Google sends a confirmation email).
//   3. Mark "Treat as alias" enabled.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient, createServiceRoleClient } from "../_shared/supabase-client.ts";

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
      .select("id, role")
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

    const { data: settings } = await sb
      .from("settings")
      .select("account_manager_email")
      .eq("id", 1)
      .single();
    const fromEmail =
      (settings as { account_manager_email?: string } | null)?.account_manager_email
      ?? "accountmanager@convertedclick.co.za";

    const accessToken = Deno.env.get("GOOGLE_ACCESS_TOKEN");
    if (!accessToken) {
      // Save error for visibility.
      await sb
        .from("outbound_emails")
        .update({ status: "send_failed", send_error: "GOOGLE_ACCESS_TOKEN secret not set" })
        .eq("id", row.id);
      return json({ error: "GOOGLE_ACCESS_TOKEN secret not set" }, 500);
    }

    const rfc822 = buildRfc822({
      fromEmail,
      to: row.to_addresses,
      cc: row.cc_addresses,
      bcc: row.bcc_addresses,
      subject: row.subject,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
    });
    const raw = base64UrlEncode(rfc822);

    const body: Record<string, unknown> = { raw };
    if (row.gmail_thread_id) body.threadId = row.gmail_thread_id;

    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      await sb
        .from("outbound_emails")
        .update({ status: "send_failed", send_error: `Gmail ${res.status}: ${errText}` })
        .eq("id", row.id);
      return json({ error: `Gmail send failed: ${res.status} ${errText}` }, 502);
    }
    const sent = (await res.json()) as { id: string; threadId: string };

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

function buildRfc822(args: {
  fromEmail: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): string {
  const boundary = `cc_${crypto.randomUUID()}`;
  const headers: string[] = [
    `From: Converted Click Account Manager <${args.fromEmail}>`,
    `To: ${args.to.join(", ")}`,
  ];
  if (args.cc.length) headers.push(`Cc: ${args.cc.join(", ")}`);
  if (args.bcc.length) headers.push(`Bcc: ${args.bcc.join(", ")}`);
  headers.push(
    `Subject: ${args.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );
  const body =
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n${args.bodyText}\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n${args.bodyHtml}\r\n\r\n` +
    `--${boundary}--`;
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function base64UrlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
