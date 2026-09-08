// src/lib/client-outbound.ts
//
// One person, one link, one email — the step every client-facing send makes.
//
// Three flows mint a personal token and put a letter on it: a question
// (useClientAsks), a message against one item (useClientActivity) and a chase
// across the whole list (useClientChase). They differ in what happens AROUND
// this step — which row is written before it, which row gets stamped with the
// outbound id afterwards — and not at all in the step itself, which is why it
// lives here once instead of three times.
//
// It throws on the database legs and RETURNS the send failure as a string. A
// token or an outbound row that will not write is broken and should stop
// everything; one bad address must not strand the recipients queued behind it.

import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";
import { errorMessage } from "@/lib/utils";
import type { ClientEmail } from "@/lib/client-email";
import { newPlaintextToken, reviewUrlFor, sha256Hex } from "@/hooks/useClientReviewLinks";

/**
 * How long a link minted by one of these sends stays alive.
 *
 * Every send mints its own token — the store is hash-only, so an existing link
 * cannot be recovered to reuse. Without an expiry a client would accumulate one
 * permanently live link per question, message and chase ever sent. Sixty days
 * is long enough that nobody is locked out of a thread they are still working,
 * and short enough that a two-year-old email is not a key to their account.
 *
 * It lives here because all three flows share it; it used to be three
 * constants, each with a comment claiming to match the others.
 */
export const LINK_DAYS = 60;

/** Who it is going to. `id` is the contacts row the token is scoped to (0142). */
export type OutboundContact = { id: string; email: string; name?: string | null };

export async function sendOnPersonalLink(args: {
  clientId: string;
  briefId?: string | null;
  contact: OutboundContact;
  /** What the link is for, as it reads in the links panel. */
  label: string;
  expiresAt: string;
  createdBy: string;
  template: string;
  /** The letter, built once the link exists — the link goes inside it. */
  build: (url: string) => ClientEmail;
}): Promise<{ url: string; outboundId: string; sendError: string | null }> {
  const token = newPlaintextToken();
  const { error: tokenErr } = await supabase.from("client_review_tokens").insert({
    client_id: args.clientId,
    contact_id: args.contact.id,
    token_hash: await sha256Hex(token),
    label: args.label.slice(0, 120),
    expires_at: args.expiresAt,
    created_by: args.createdBy,
  });
  if (tokenErr) throw new Error(errorMessage(tokenErr));
  const url = reviewUrlFor(token);

  const mail = args.build(url);
  const { data: outbound, error: outboundErr } = await supabase
    .from("outbound_emails")
    .insert({
      client_id: args.clientId,
      brief_id: args.briefId ?? null,
      composed_by: args.createdBy,
      to_addresses: [args.contact.email],
      subject: mail.subject,
      body_text: mail.bodyText,
      body_html: mail.bodyHtml,
      approval_link: url,
      template: args.template,
      status: "draft",
    })
    .select("id")
    .single();
  if (outboundErr) throw new Error(errorMessage(outboundErr));
  const outboundId = (outbound as { id: string }).id;

  try {
    await callEdgeFn("send-outbound-email", { outbound_email_id: outboundId });
    return { url, outboundId, sendError: null };
  } catch (e) {
    return { url, outboundId, sendError: `${args.contact.email}: ${errorMessage(e)}` };
  }
}
