// src/lib/client-review.ts
//
// Pure derivations for the client sign-off inbox. No network, no React — the
// page, the queue and the bucket rail all read from here so "which pane is
// this in" and "how late is it" have exactly one definition.
//
// Everything a client sees about *time* is computed here in the LOCAL
// timezone via @/lib/dates. Converted Click runs on SAST; a UTC date compare
// tells a client an item is overdue two hours before it is.

import { todayISO } from "@/lib/dates";
import type { ReviewBucket, ReviewItem, ReviewItemType, ReviewMessage } from "@/types/client-review";

/**
 * The address a client replies to. Deliberately a team mailbox, never a
 * person: the only two parties in the client's view are their company and
 * "Converted Click", so no screen and no email header may carry a staff name.
 *
 * CONFIRM BEFORE GO-LIVE: this address is not used anywhere else in the repo
 * (the addresses that are — brendan@, lisa@ — are staff and therefore barred
 * here). Point it at a mailbox someone actually reads, or a client's reply
 * lands nowhere. It is a constant precisely so that is a one-line change.
 */
export const REVIEW_REPLY_TO = "hello@convertedclick.co.za";

/**
 * Which pane an item sits in. The ball is with whoever has to act next:
 *   pending           → the client has not decided, so it is their move…
 *   …unless owed_by is "us": an agreement WE made is ours to deliver, so it
 *                       sits under "With us" and carries no buttons. Putting
 *                       our own commitment in their "Your move" pile would
 *                       ask them to close something they cannot do.
 *   changes_requested → they answered and it came back to us
 *   approved          → done, kept for the record
 */
export function bucketOf(item: ReviewItem): ReviewBucket {
  if (item.state === "pending") return item.owed_by === "us" ? "with-us" : "your-move";
  if (item.state === "changes_requested") return "with-us";
  return "signed-off";
}

/**
 * Past its due date and still undecided. A decided item is never overdue —
 * once they have answered, how long it took is our record to keep, not a
 * reproach to keep showing them.
 */
export function isOverdue(item: ReviewItem): boolean {
  // Our own late commitment is not a reproach to show a client in red on
  // their own page — it is ours to fix, and the staff table already flags it.
  if (item.owed_by === "us") return false;
  if (item.state !== "pending" || !item.due_date) return false;
  return item.due_date < todayISO();
}

/** Whole days past due, or 0 when not overdue. Calendar days, local time. */
export function daysOverdue(item: ReviewItem): number {
  if (!isOverdue(item) || !item.due_date) return 0;
  const due = new Date(`${item.due_date}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / 86_400_000));
}

/** How many items sit in each pane. Every bucket is present, even at zero. */
export function bucketCounts(items: ReviewItem[]): Record<ReviewBucket, number> {
  const counts: Record<ReviewBucket, number> = {
    "your-move": 0,
    "with-us": 0,
    "signed-off": 0,
  };
  for (const item of items) counts[bucketOf(item)] += 1;
  return counts;
}

/**
 * Queue order: what needs them most, first.
 *   1. undecided before decided
 *   2. within undecided, longest-waiting first (see pressureDays) — an item 31
 *      days late outranks one due tomorrow, and an undated ask that has sat
 *      with the client for a month outranks both. Undated items used to sort
 *      last on the grounds that they were "not late, just unset"; in practice
 *      that buried the oldest asks on the page, because the ones nobody set a
 *      date for are exactly the ones nobody chased.
 *   3. within undecided and equally pressured, soonest due date first
 *   4. within decided, most recently decided first
 *   5. title as the final tie-break, so the order is stable across renders
 */
export function sortForQueue(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => {
    const aPending = a.state === "pending";
    const bPending = b.state === "pending";
    if (aPending !== bPending) return aPending ? -1 : 1;

    if (aPending) {
      const ap = pressureDays(a);
      const bp = pressureDays(b);
      if (ap !== bp) return bp - ap;
      if (a.due_date !== b.due_date) {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date < b.due_date ? -1 : 1;
      }
    } else if (a.decided_at !== b.decided_at) {
      if (!a.decided_at) return 1;
      if (!b.decided_at) return -1;
      return a.decided_at > b.decided_at ? -1 : 1;
    }

    return a.client_title.localeCompare(b.client_title);
  });
}

/**
 * The freshness stamp — "As at 08:31". Half this data rides a 30-minute cron,
 * so the page says how old it is rather than implying it is live.
 * Returns an empty string for an unparseable timestamp so the caller renders
 * nothing rather than "As at Invalid Date".
 */
export function formatAsAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * What the client is being asked to do, in their words. The chip is the only
 * thing that tells three very different asks apart in a single queue, so it
 * says the ACT, not the record type: "Question", not "client_approvals row of
 * type question".
 */
export const TYPE_LABEL: Record<ReviewItemType, string> = {
  brief: "Sign-off",
  question: "Question",
  agreement: "You agreed",
};

/** The chip, which for an agreement depends on who made the promise. */
export function typeLabelFor(item: ReviewItem): string {
  if (item.item_type === "agreement") return item.owed_by === "us" ? "We agreed" : "You agreed";
  return TYPE_LABEL[item.item_type];
}

const VIA_PHRASE: Record<string, string> = {
  meeting: "in a meeting",
  call: "on a call",
  email: "by email",
  message: "in a message",
  other: "with us",
};

/**
 * "Agreed on 4 August, in a meeting." — the sentence the agreement type exists
 * for. Returns null for any item that is not a dated agreement, so the caller
 * renders nothing rather than a half-sentence.
 */
export function agreedLine(item: ReviewItem): string | null {
  if (item.item_type !== "agreement" || !item.agreed_at) return null;
  const [y, m, d] = item.agreed_at.split("-").map(Number);
  if (!y || !m || !d) return null;
  const when = new Date(y, m - 1, d).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
  });
  const via = item.agreed_via ? VIA_PHRASE[item.agreed_via] : null;
  const who = item.owed_by === "us" ? "We agreed" : "Agreed";
  return via ? `${who} on ${when}, ${via}.` : `${who} on ${when}.`;
}

/**
 * How a pending item reads on the badge.
 *
 * Four shapes, and the fourth is the one that matters. "Overdue" alone told a
 * client nothing about which of six items to open first — and the queue IS
 * ordered by exactly that, so with no number a correct order looked arbitrary.
 *
 * `waiting` covers the item with no due date at all, which is most of them:
 * plenty of asks go out without one, but an ask with no date still has an age,
 * and something sitting untouched on a client's list is not "no deadline". Its
 * count comes from the linked task's ClickUp waiting-on-client clock rather
 * than the row's created_at, because rows drafted from ClickUp are written in
 * a batch weeks after the client first got the work — created_at would report
 * every one of them as brand new.
 *
 * It is deliberately NOT called overdue. Nothing was ever due, so a client
 * asked "which date did I miss?" would have no answer, and this whole feature
 * lives or dies on numbers that survive being questioned.
 *
 * `null` for anything decided — once they have answered, how late it was is
 * our record to keep, not a reproach to keep showing them — and for an undated
 * item nobody has been waiting on for a whole day yet.
 */
export type DueStatus =
  | { kind: "overdue"; days: number }
  | { kind: "today" }
  | { kind: "upcoming"; days: number }
  | { kind: "waiting"; days: number }
  | null;

export function dueStatus(item: ReviewItem): DueStatus {
  if (item.state !== "pending" || item.owed_by === "us") return null;

  if (!item.due_date) {
    const days = Math.floor((item.waiting_ms ?? 0) / 86_400_000);
    return days > 0 ? { kind: "waiting", days } : null;
  }

  const due = new Date(`${item.due_date}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { kind: "overdue", days: -days };
  if (days === 0) return { kind: "today" };
  return { kind: "upcoming", days };
}

/**
 * How long this has been the client's problem, in whole days — past its date
 * if it had one, else how long it has sat with them. One number, so the queue
 * can rank a 30-day undated ask above a 2-day-late dated one instead of
 * dumping every undated item at the bottom.
 */
export function pressureDays(item: ReviewItem): number {
  const status = dueStatus(item);
  if (!status) return 0;
  return status.kind === "overdue" || status.kind === "waiting" ? status.days : 0;
}

/**
 * The whole conversation on one item, oldest first: the ask, everything said
 * since, and — last — whatever they wrote when they decided.
 *
 * That last part is the one worth explaining. A client's answer is stored on
 * `client_note`, not as a message row, so it used to vanish from the thread
 * entirely: they typed an answer, it disappeared, and a banner appeared above
 * the conversation saying we had it. Their own words belong in the thread, in
 * their own bubble, at the time they sent them — like every other messaging
 * surface anyone has used.
 *
 * Sorted at the end rather than assumed, because a message sent after a
 * decision (which the page allows) would otherwise sit above it.
 */
export function threadOf(item: ReviewItem): ReviewMessage[] {
  const thread: ReviewMessage[] = [
    {
      id: `ask-${item.id}`,
      from: "us",
      author: null,
      body: item.ask,
      at: item.created_at,
    },
    ...item.messages,
  ];

  if (item.client_note?.trim() && item.decided_at) {
    thread.push({
      id: `decision-${item.id}`,
      from: "them",
      author: item.decided_by_name,
      body: item.client_note,
      at: item.decided_at,
    });
  }

  return thread.sort((a, b) => a.at.localeCompare(b.at));
}
