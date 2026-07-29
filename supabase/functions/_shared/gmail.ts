// supabase/functions/_shared/gmail.ts
//
// Shared Gmail send-as helper (RFC822 build + send). Used by both
// send-outbound-email (user-initiated client email) and
// notify-extension-request (system-triggered internal notification) so the
// message-building logic isn't duplicated.

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
    `From: ${args.fromName ?? "Converted Click"} <${args.fromEmail}>`,
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
