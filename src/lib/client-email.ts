// src/lib/client-email.ts
//
// The emails that carry something to a client and bring them back to their
// sign-off page.
//
// Two kinds share one shell, because they are the same letter with a different
// middle: a QUESTION ("we need an answer") and a MESSAGE ("here is where we're
// at, this is still with you"). Both end with the same button to the same
// page, which is the only reason either gets answered.
//
// Templates rather than a compose screen, on purpose: there is nothing to
// write except the point being made. A chase that takes two minutes to write
// is a chase that happens next week.
//
// Pure — no network, no React. Escaping lives here too, because the body is
// free text typed by staff and lands inside HTML.

export type ClientEmail = {
  subject: string;
  bodyText: string;
  bodyHtml: string;
};

/**
 * How much is sitting on the client's sign-off page, by the same three buckets
 * they see when they arrive. Counted at send time — see fetchStageCounts.
 *
 * `oldestDays` is how long the longest-waiting item has been theirs, which is
 * the figure that actually moves people: "3 waiting" is background noise next
 * to "the oldest has been waiting 32 days". 0 when nothing is late or sitting.
 */
export type StageCounts = {
  waitingOnYou: number;
  withUs: number;
  signedOff: number;
  oldestDays: number;
};

/**
 * The reminder block renders whenever the client has anything on their page at
 * all — waiting, with us, or already settled.
 *
 * It used to require `waitingOnYou > 0`, on the argument that "0 waiting on
 * you" undoes a chase. That was right about a chase and wrong about everything
 * else: the moment a client answered the last open item the block vanished
 * from every subsequent email, which reads as a bug rather than as reassurance.
 * "0 · 0 · 1 signed off" is a true and useful sentence to send someone who is
 * clear. The only case that still shows nothing is a client with a genuinely
 * empty page, where there is nothing to report.
 */
function shouldShowCounts(counts: StageCounts | null | undefined): counts is StageCounts {
  return !!counts && counts.waitingOnYou + counts.withUs + counts.signedOff > 0;
}

/**
 * Three table cells. Tables are the one thing every mail client gets right —
 * no flexbox, no grid, no CSS custom properties reach an inbox. Rounded
 * corners are ignored by Outlook's Word engine and the cells simply go square,
 * which is why the emphasis is carried by weight and colour, not by shape.
 *
 * Only the first figure is coloured. Shouting three times emphasises nothing.
 */
function countsHtml(c: StageCounts): string {
  const cell = (value: number, label: string, color: string) =>
    `<td width="33%" style="background:#F2F4F7;border-radius:6px;padding:12px 6px;text-align:center;">` +
    `<div style="font:700 22px/1 Helvetica,Arial,sans-serif;color:${color};">${value}</div>` +
    `<div style="font:11px/1.35 Helvetica,Arial,sans-serif;color:#667085;padding-top:5px;">${label}</div>` +
    `</td>`;

  const hasOldest = c.oldestDays > 0;
  const oldest = hasOldest
    ? `<p style="font:12px/1.4 Helvetica,Arial,sans-serif;color:#B54708;margin:0 0 16px;">` +
      `The oldest has been waiting <strong>${c.oldestDays} ${c.oldestDays === 1 ? "day" : "days"}</strong>.</p>`
    : "";

  // The gap below the strip belongs to whichever element ends the block. A
  // negative margin would have been the quick way to tighten the oldest line
  // against the cells; mail clients handle negative margins unreliably, so the
  // spacing is simply handed over instead.
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:6px 0;margin:0 0 ${hasOldest ? "8px" : "16px"};">
  <tr>
    ${cell(c.waitingOnYou, "Waiting on you", "#B54708")}
    ${cell(c.withUs, "With us", "#344054")}
    ${cell(c.signedOff, "Signed off", "#344054")}
  </tr>
</table>${oldest}`.trim();
}

function countsText(c: StageCounts): string {
  const line = `Waiting on you: ${c.waitingOnYou} · With us: ${c.withUs} · Signed off: ${c.signedOff}`;
  return c.oldestDays > 0
    ? `${line}\nThe oldest has been waiting ${c.oldestDays} ${c.oldestDays === 1 ? "day" : "days"}.`
    : line;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "2026-09-04" -> "4 September". Built from parts, never `new Date(str)`. */
function formatDueDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { day: "numeric", month: "long" });
}

/**
 * "Brendan Gunn" -> "Hi Brendan,". We greet people by first name; the full
 * name is for the record (who signed a thing off), not for the top of a note.
 *
 * First whitespace-delimited token, so "Mary-Anne Smith" keeps its hyphen and
 * a one-word name is left alone. A contact stored surname-first would greet
 * wrongly — the fix for that is the contact row, not a guess here.
 */
function greeting(contactName?: string | null): string {
  const first = contactName?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hi there,";
}

/**
 * The shell every client email shares: greeting, a quoted block of whatever we
 * are actually saying, the button, a pasteable URL, and a sign-off from
 * "Converted Click" rather than any individual — the only two parties a client
 * ever sees are their company and ours.
 *
 * Inline styles only: every mail client that matters strips <style> blocks.
 * The button is a real <a href>, which is also the whole reason an in-inbox
 * Approve button is out of reach — see the sign-off notes in CLAUDE.md.
 *
 * WIDTH IS A WRAPPER, NOT A CSS PROPERTY. Without the nested table below the
 * body fills whatever reading pane it lands in — on a wide monitor that put
 * the three count cells almost a full screen apart and made a short note look
 * like a billboard. The outer table spans, the inner one is pinned to 600px:
 * `width="600"` as an attribute for Outlook's Word engine, which ignores
 * max-width, and `max-width:600px;width:100%` for everything else so it still
 * collapses on a phone. Left-aligned, not centred — a centred column reads as
 * a marketing template, and this is meant to read as a note from a person.
 */
function render(args: {
  subject: string;
  lead: string;
  quoted: string;
  callToAction: string;
  buttonLabel: string;
  url: string;
  contactName?: string | null;
  counts?: StageCounts | null;
}): ClientEmail {
  const hello = greeting(args.contactName);
  // Aliased to a local so the type guard narrows it — a predicate on a
  // parameter property does not carry through to later uses of args.counts.
  const counts = args.counts;
  const show = shouldShowCounts(counts);

  const bodyText = [
    hello,
    "",
    args.lead,
    "",
    args.quoted.trim(),
    ...(show ? ["", countsText(counts)] : []),
    "",
    args.callToAction,
    args.url,
    "",
    "Anything else waiting on you is on that same page.",
    "",
    "Thanks,",
    "Converted Click",
  ].join("\n");

  // One paragraph style, repeated. <p> inherits its font from the container in
  // most clients but not in Outlook, so each one says it out loud.
  const para = "margin:0 0 16px;font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#344054;";

  const bodyHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr><td align="left" style="padding:0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:600px;width:100%;">
<tr><td style="padding:0;font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#344054;">
<p style="${para}">${escapeHtml(hello)}</p>
<p style="${para}">${args.lead.startsWith("<") ? args.lead : escapeHtml(args.lead)}</p>
<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #d0d5dd;color:#344054;">
  ${escapeHtml(args.quoted.trim()).replace(/\n/g, "<br>")}
</blockquote>
${show ? countsHtml(counts) : ""}
<p style="${para}">${escapeHtml(args.callToAction)}</p>
<p style="${para}">
  <a href="${escapeHtml(args.url)}"
     style="display:inline-block;padding:10px 20px;border-radius:999px;background:#1f2937;color:#ffffff;text-decoration:none;font-weight:600;">
    ${escapeHtml(args.buttonLabel)}
  </a>
</p>
<p style="${para}">Anything else waiting on you is on that same page.</p>
<p style="${para}">Thanks,<br>Converted Click</p>
</td></tr>
</table>
</td></tr>
</table>`.trim();

  return { subject: args.subject, bodyText, bodyHtml };
}

/**
 * @param title    what this is about — the client-facing title, never a raw
 *                 ClickUp subject with "DFT V1.1" in it.
 * @param question the question itself, as typed.
 * @param url      this person's own review link (0142).
 * @param dueDate  optional "YYYY-MM-DD" — when we need the answer by.
 */
export function buildQuestionEmail(args: {
  title: string;
  question: string;
  url: string;
  dueDate?: string | null;
  contactName?: string | null;
  counts?: StageCounts | null;
}): ClientEmail {
  const by = args.dueDate ? ` We'd like to have it by ${formatDueDate(args.dueDate)}.` : "";
  return render({
    subject: `Quick question — ${args.title}`,
    lead: `We have a question on ${args.title}:`,
    quoted: args.question,
    callToAction: `You can answer it here — no login needed.${by}`,
    buttonLabel: "Answer the question",
    url: args.url,
    contactName: args.contactName,
    counts: args.counts,
  });
}

/**
 * A message against something already waiting on them — a chase, an update, a
 * nudge. The subject deliberately reuses the item's title rather than saying
 * "Message from Converted Click", so it threads in their head with everything
 * else about that piece of work.
 */
export function buildMessageEmail(args: {
  title: string;
  message: string;
  url: string;
  url_label?: string;
  contactName?: string | null;
  counts?: StageCounts | null;
}): ClientEmail {
  return render({
    subject: `${args.title} — an update from Converted Click`,
    lead: `About ${args.title}:`,
    quoted: args.message,
    callToAction: "You can pick this up here — no login needed.",
    buttonLabel: args.url_label ?? "Open your sign-off page",
    url: args.url,
    contactName: args.contactName,
    counts: args.counts,
  });
}
