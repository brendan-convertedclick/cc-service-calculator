// supabase/functions/_shared/gmail.ts
//
// Shared Gmail send-as helper. Two layers:
//   buildRfc822/sendGmail  — transport, used by send-outbound-email.
//   sendNotificationEmails — the outbound_emails-row-per-recipient loop the
//                            three notify-* functions all share.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getGoogleAccessToken } from "./google-token.ts";

/**
 * RFC 2047 encoded-word for a header value.
 *
 * Headers are ASCII. A UTF-8 byte sequence dropped into Subject: raw arrives as
 * mojibake — an em dash renders as "Ã¢Â€Â", which is exactly what happened to
 * every subject line containing one. Anything non-ASCII has to be announced as
 * encoded, not merely sent as bytes.
 */
export function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const utf8 = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export function buildRfc822(args: {
  fromEmail: string;
  fromName?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): string {
  const boundary = `cc_${crypto.randomUUID()}`;
  const headers: string[] = [
    `From: ${encodeHeaderWord(args.fromName ?? "Converted Click")} <${args.fromEmail}>`,
    `To: ${args.to.join(", ")}`,
  ];
  if (args.cc.length) headers.push(`Cc: ${args.cc.join(", ")}`);
  if (args.bcc.length) headers.push(`Bcc: ${args.bcc.join(", ")}`);
  headers.push(
    `Subject: ${encodeHeaderWord(args.subject)}`,
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

export function base64UrlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type SendGmailResult =
  | { ok: true; id: string; threadId: string }
  | { ok: false; error: string };

/** POST a message via the Gmail API using a bearer access token. Never throws. */
export async function sendGmail(args: {
  accessToken: string;
  fromEmail: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  threadId?: string | null;
}): Promise<SendGmailResult> {
  try {
    const rfc822 = buildRfc822({
      fromEmail: args.fromEmail,
      fromName: args.fromName,
      to: args.to,
      cc: args.cc ?? [],
      bcc: args.bcc ?? [],
      subject: args.subject,
      bodyHtml: args.bodyHtml,
      bodyText: args.bodyText,
    });
    const raw = base64UrlEncode(rfc822);
    const body: Record<string, unknown> = { raw };
    if (args.threadId) body.threadId = args.threadId;

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${args.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Gmail ${res.status}: ${await res.text()}` };
    const sent = (await res.json()) as { id: string; threadId: string };
    return { ok: true, id: sent.id, threadId: sent.threadId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Send one internal notification email per recipient, recording each as an
 * outbound_emails row (audit trail) before and after the send.
 *
 * The three notify-* functions each had an identical copy of this loop, all
 * reading a hand-pasted GOOGLE_ACCESS_TOKEN secret that stopped existing when
 * send-outbound-email moved to per-person Google grants — so every one of them
 * failed with "GOOGLE_ACCESS_TOKEN secret not set". The token now comes from
 * getGoogleAccessToken, the same path send-outbound-email and the calendar
 * integration use.
 *
 * Unlike send-outbound-email, the operator fallback is ALLOWED here. These are
 * internal notices to our own approvers, not client correspondence: a staff
 * member without their own Google grant should still get their brief noticed.
 * The guard against misattribution is that fromName stays "Converted Click" —
 * we never sign a fallback send with a person's name, and the body already
 * says who submitted it.
 */
export async function sendNotificationEmails(args: {
  req: Request;
  sb: SupabaseClient;
  composedBy: string;
  recipientEmails: (string | null)[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
}): Promise<string[]> {
  const grant = await getGoogleAccessToken(args.req);
  const failure = grant.accessToken == null
    ? grant.error ?? "No Google account connected — sign in with Google to send notifications."
    : null;

  const notified: string[] = [];
  for (const email of args.recipientEmails) {
    if (!email) continue;
    const { data: outbound } = await args.sb.from("outbound_emails").insert({
      composed_by: args.composedBy,
      to_addresses: [email],
      subject: args.subject,
      body_text: args.bodyText,
      body_html: args.bodyHtml,
      status: "draft",
    }).select("id").single();
    if (!outbound?.id) continue;

    if (failure) {
      await args.sb.from("outbound_emails")
        .update({ status: "send_failed", send_error: failure })
        .eq("id", outbound.id);
      continue;
    }

    const sent = await sendGmail({
      accessToken: grant.accessToken!,
      fromEmail: grant.googleEmail ?? "",  // null column: Gmail rewrites From to the authenticated user
      fromName: "Converted Click",
      to: [email],
      subject: args.subject,
      bodyText: args.bodyText,
      bodyHtml: args.bodyHtml,
    });
    if (sent.ok) {
      await args.sb.from("outbound_emails").update({
        status: "sent",
        gmail_message_id: sent.id,
        gmail_thread_id: sent.threadId,
        sent_at: new Date().toISOString(),
        send_error: null,
      }).eq("id", outbound.id);
      notified.push(email);
    } else {
      await args.sb.from("outbound_emails")
        .update({ status: "send_failed", send_error: sent.error })
        .eq("id", outbound.id);
    }
  }
  return notified;
}
