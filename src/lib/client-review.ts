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
import type { ReviewBucket, ReviewItem } from "@/types/client-review";

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
 * Which pane an item sits in. Derived from state alone — the ball is with
 * whoever has to act next:
 *   pending           → the client has not decided, so it is their move
 *   changes_requested → they answered and it came back to us
 *   approved          → done, kept for the record
 */
export function bucketOf(item: ReviewItem): ReviewBucket {
  if (item.state === "pending") return "your-move";
  if (item.state === "changes_requested") return "with-us";
  return "signed-off";
}

/**
 * Past its due date and still undecided. A decided item is never overdue —
 * once they have answered, how long it took is our record to keep, not a
 * reproach to keep showing them.
 */
export function isOverdue(item: ReviewItem): boolean {
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
 *   2. within undecided, oldest due date first — an item 31 days late outranks
 *      one due tomorrow. No due date sorts last: it is not late, it is unset.
 *   3. within decided, most recently decided first
 *   4. title as the final tie-break, so the order is stable across renders
 */
export function sortForQueue(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => {
    const aPending = a.state === "pending";
    const bPending = b.state === "pending";
    if (aPending !== bPending) return aPending ? -1 : 1;

    if (aPending) {
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
