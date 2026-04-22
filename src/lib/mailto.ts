/**
 * Build a mailto: URL with URL-encoded subject and body.
 *
 * Consumers (Inbox "Needs info", Send quote) build an href that opens
 * the user's mail client pre-filled. Encoding uses URLSearchParams with a
 * `+`→`%20` fix-up so the result is compatible with Gmail's compose window.
 */
type Args = {
  to: string;
  subject?: string;
  body?: string;
  cc?: string;
  bcc?: string;
};

export function mailto({ to, subject, body, cc, bcc }: Args): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  if (cc) params.set("cc", cc);
  if (bcc) params.set("bcc", bcc);
  const q = params.toString().replace(/\+/g, "%20");
  return q ? `mailto:${to}?${q}` : `mailto:${to}`;
}
