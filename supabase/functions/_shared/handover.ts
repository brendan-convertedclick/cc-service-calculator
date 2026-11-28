// supabase/functions/_shared/handover.ts
//
// The pure half of handover-signoffs: given what ClickUp says about a task,
// decide whether the doer actually handed it over, and what of it to keep.
// No I/O, no Deno — src/lib/handover.test.ts runs it under vitest.
//
// THE GATE is the check a person used to do before work reached a client. A
// hand-over needs both:
//   * a closing comment — the doer's own words for what was done. It becomes
//     the item's `detail`, verbatim, which is what the client reads; and
//   * proof — at least one file on the task, or a link in that comment.
// Either missing and nothing is drafted: the task goes back to the doer.
//
// "Closing" means newer than the last decision on this brief. After the client
// asks for changes, the comment that explained the first round is not an
// account of the second, so a rework needs fresh words (and fresh files are
// the ones kept).

/** What Conductor writes on a ClickUp task. Comments starting with it are ours, never a doer's. */
export const CONDUCTOR_MARK = "🤖 Conductor";

/** Machine audit comments (BRIEF::, EXTENSION::, REVISION::, LOG:: …) are posted
 *  under a person's PAT on every briefed task, so they must never count as the
 *  doer's closing comment. */
const AUDIT_COMMENT = /^[A-Z][A-Z_]*::/;

/** Shorter than this is "done" or "see attached" — not an account of the work. */
export const MIN_COMMENT_CHARS = 20;

export const MAX_PROOF_FILES = 10;
export const MAX_PROOF_BYTES = 20 * 1024 * 1024;

export type CuComment = {
  id: string;
  comment_text?: string | null;
  date?: string | number | null; // ClickUp sends ms as a string
  user?: { id?: number | null; username?: string | null; email?: string | null } | null;
};

export type CuAttachment = {
  id: string;
  title?: string | null;
  url?: string | null;
  extension?: string | null;
  mimetype?: string | null;
  size?: number | string | null;
  date?: string | number | null;
};

export type ClosingComment = { id: string; text: string; author: string; at: number };

export type GateResult =
  | { ok: true; comment: ClosingComment; links: string[]; files: CuAttachment[] }
  | { ok: false; missing: ("comment" | "proof")[]; comment: ClosingComment | null };

const ms = (v: string | number | null | undefined): number => {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
};

/** The newest comment a person wrote after `since` (ms), or null. */
export function closingComment(comments: CuComment[], since: number): ClosingComment | null {
  const mine = comments
    .map((c) => ({
      id: String(c.id),
      text: String(c.comment_text ?? "").trim(),
      author: String(c.user?.username ?? "").trim() || "Someone",
      at: ms(c.date),
    }))
    .filter((c) => c.text && !c.text.startsWith(CONDUCTOR_MARK) && !AUDIT_COMMENT.test(c.text) && c.at > since)
    .sort((a, b) => b.at - a.at);
  return mine[0] ?? null;
}

/**
 * Web addresses in the comment, de-duplicated, in the order written. Only
 * http(s), no credentials — these land on the client's page as chips (0162),
 * and trailing punctuation from a sentence is not part of an address.
 */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/https?:\/\/[^\s<>()"']+/gi) ?? []) {
    const trimmed = raw.replace(/[.,;:!?\]]+$/, "");
    try {
      const u = new URL(trimmed);
      if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) continue;
      if (!out.includes(u.toString())) out.push(u.toString());
    } catch {
      // not an address after all
    }
  }
  return out;
}

/**
 * ClickUp links are where the team works, not something a client can open —
 * and an internal URL on a client's page is the one thing 0162 warns about.
 */
export function isInternalLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)clickup\.com$/.test(host) || /(^|\.)clickup-attachments\.com$/.test(host);
  } catch {
    return true;
  }
}

/** The files worth copying: newer than `since`, not too big, at most MAX_PROOF_FILES, newest first. */
export function proofFiles(attachments: CuAttachment[], since: number): CuAttachment[] {
  return attachments
    .filter((a) => a.url && ms(a.date) > since)
    .filter((a) => ms(a.size) <= MAX_PROOF_BYTES)
    .sort((a, b) => ms(b.date) - ms(a.date))
    .slice(0, MAX_PROOF_FILES);
}

export function gate(comments: CuComment[], attachments: CuAttachment[], since: number): GateResult {
  const comment = closingComment(comments, since);
  const usable = comment && comment.text.length >= MIN_COMMENT_CHARS ? comment : null;
  const links = usable ? linksIn(usable.text).filter((l) => !isInternalLink(l)) : [];
  const files = proofFiles(attachments, since);
  const missing: ("comment" | "proof")[] = [];
  if (!usable) missing.push("comment");
  if (!files.length && !links.length) missing.push("proof");
  if (missing.length) return { ok: false, missing, comment };
  return { ok: true, comment: usable!, links, files };
}

/** Safe storage object name: keeps the extension, drops anything a path would choke on. */
export function storageName(title: string, index: number): string {
  const clean = String(title || "file").normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^[.-]+/, "").slice(-80);
  return `${String(index + 1).padStart(2, "0")}-${clean || "file"}`;
}

/**
 * The status a bounced task goes back to: the list's in-progress status if it
 * has one, else its first open one. Lists name their statuses freely, so this
 * reads the list rather than assuming a word.
 */
export function bounceStatus(statuses: { status: string; type?: string; orderindex?: number }[]): string | null {
  const sorted = [...statuses].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0));
  const progress = sorted.find((s) => /progress|doing|working/i.test(s.status) && s.type !== "closed");
  if (progress) return progress.status;
  const open = sorted.find((s) => s.type === "open") ?? sorted.find((s) => s.type !== "closed" && s.type !== "done");
  return open?.status ?? null;
}

/** The words a bounced doer reads on their task. */
export function bounceComment(missing: ("comment" | "proof")[]): string {
  const asks = [
    missing.includes("comment")
      ? `a closing comment (${MIN_COMMENT_CHARS}+ characters) saying what was done, in words the client will read`
      : null,
    missing.includes("proof") ? "the proof: attach the file or screenshot, or put the live link in that comment" : null,
  ].filter(Boolean);
  return `${CONDUCTOR_MARK}: not sent to the client yet. Before moving this to "send to client", add ${asks.join(" and ")}. Then move it to "send to client" again.`;
}
