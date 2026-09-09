// src/lib/client-review.ts
//
// Pure derivations for the client sign-off inbox. No network, no React — the
// page, the queue and the bucket rail all read from here so "which pane is
// this in" and "how late is it" have exactly one definition.
//
// Everything a client sees about *time* is computed here in the LOCAL
// timezone via @/lib/dates. Converted Click runs on SAST; a UTC date compare
// tells a client an item is overdue two hours before it is.

import type { CalendarEntry } from "@/lib/calendar-month";
import { todayISO, toISODate } from "@/lib/dates";
import type { StopClockSource } from "@/lib/stop-clock";
import type {
  ReviewBucket,
  ReviewItem,
  ReviewItemType,
  ReviewMessage,
  ReviewMove,
  ReviewOpen,
  ReviewScheduleRow,
  ReviewWork,
} from "@/types/client-review";

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
 *   …unless the linked task's own ClickUp clock says the work has come back
 *                       to our side: whoever is HOLDING IT UP is whose pane it
 *                       is in. An approval we asked for that we are now
 *                       reworking is not their move, and listing it under
 *                       "Your move" asks them to act on something they cannot.
 *   changes_requested → they answered and it came back to us
 *   approved          → done, kept for the record
 *   noted             → an event: a date, in nobody's court at all
 *
 * A finished task (court "done") does NOT settle anything: the work landing is
 * not the client agreeing to it, and moving an undecided ask into "Signed off"
 * would claim a sign-off nobody gave. It stays their move, which is what it is
 * — we are done, they have not answered.
 */
export function bucketOf(item: ReviewItem): ReviewBucket {
  // An event is a date, not a job. It is in nobody's court, which is exactly
  // why it has its own state (0149) rather than being filtered out of the
  // three that are all about whose move it is.
  if (item.state === "noted") return "coming-up";
  if (item.state === "pending") {
    return item.owed_by === "us" || item.court === "us" ? "with-us" : "your-move";
  }
  if (item.state === "changes_requested") return "with-us";
  return "signed-off";
}

/**
 * Past its due date and still undecided. A decided item is never overdue —
 * once they have answered, how long it took is our record to keep, not a
 * reproach to keep showing them.
 */
export function isOverdue(item: ReviewItem): boolean {
  // Only ever red on something that is actually theirs to move. That covers
  // our own late commitment (owed_by "us") and anything the ClickUp clock says
  // we are currently holding — both are ours to fix, not a red mark on their
  // page — and it stays true by construction as the pane rule changes.
  if (bucketOf(item) !== "your-move") return false;
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

/**
 * Which pane a piece of briefed work sits in. THE SAME RULE `bucketOf` uses
 * for an ask, deliberately: whoever is holding it up is whose pane it is in.
 * Not a third rule, or the two halves of one list would disagree about what
 * "with us" means.
 *
 * Work is never settled and never a date, so only the two live panes apply.
 */
export function workBucketOf(w: ReviewWork): ReviewBucket {
  return w.court === "client" ? "your-move" : "with-us";
}

/**
 * How long this has been the client's problem, in whole days — the same
 * question `pressureDays` answers for an ask, so the two can be sorted into
 * one queue. Past its date if it had one, else nothing: a task carries no
 * "waiting on you" clock the client was ever told about.
 */
function workPressureDays(w: ReviewWork): number {
  if (workBucketOf(w) !== "your-move" || !w.due_date) return 0;
  const due = new Date(`${w.due_date}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / 86_400_000));
}

/**
 * The queue, asks and briefed work in ONE order.
 *
 * Interleaved rather than appended: the list is ordered by what needs them
 * most, and three tasks 26 days past their date sitting under a 6-day ask
 * contradicts that at a glance. The key is the same pressure both sides
 * already sort by, so nothing here is a second definition of "urgent".
 */
export type QueueEntry =
  | { kind: "item"; id: string; item: ReviewItem }
  | { kind: "work"; id: string; work: ReviewWork };

export function queueFor(
  items: ReviewItem[],
  work: ReviewWork[],
  bucket: ReviewBucket,
): QueueEntry[] {
  const entries: QueueEntry[] = [
    ...sortForQueue(items)
      .filter((i) => bucketOf(i) === bucket)
      .map((item) => ({ kind: "item" as const, id: item.id, item })),
    ...work
      .filter((w) => workBucketOf(w) === bucket)
      .map((w) => ({ kind: "work" as const, id: w.id, work: w })),
  ];
  // sortForQueue already ordered the asks among themselves; this only decides
  // where each task lands between them, on the one key both kinds have.
  return entries.sort((a, b) => {
    const ap = a.kind === "item" ? pressureDays(a.item) : workPressureDays(a.work);
    const bp = b.kind === "item" ? pressureDays(b.item) : workPressureDays(b.work);
    return bp - ap;
  });
}

/**
 * How many things sit in each pane. Every bucket is present, even at zero.
 *
 * `work` counts too, or the rail says 2 while the list shows 5 — the counts
 * and the rows must come from one accounting.
 */
export function bucketCounts(
  items: ReviewItem[],
  work: ReviewWork[] = [],
): Record<ReviewBucket, number> {
  const counts: Record<ReviewBucket, number> = {
    "your-move": 0,
    "with-us": 0,
    "signed-off": 0,
    "coming-up": 0,
  };
  for (const item of items) counts[bucketOf(item)] += 1;
  for (const w of work) counts[workBucketOf(w)] += 1;
  return counts;
}

/**
 * Everything the client's month view plots, from the two things their page
 * knows: the asks on their list, and the school's delivery plan beside them.
 *
 * THE POSITION OF A FINISHED THING IS WHEN IT FINISHED, not when it was due.
 * That is the whole reason the calendar can be paged backwards at all — an
 * approved sign-off sits on the day they approved it, and a delivered task on
 * the day ClickUp closed it (client_pipeline_schedule.completed_at carries
 * ClickUp's own date whenever the work was briefed). Plotting settled work on
 * its due date instead would make last month read as a row of deadlines with
 * no answer to "and did it happen?".
 *
 * Undecided asks stay on their due date, which is the date that still matters.
 *
 * Nothing here is ever marked late except an ask the client owes us — the
 * existing isOverdue rule, unchanged: our own slipped date is ours to fix and
 * not a red mark on their page (see the CLAUDE.md note on owed_by), and a
 * planned month that has not arrived cannot be late at all.
 */
export function calendarEntriesFor(
  items: (ReviewItem & { client_name?: string | null })[],
  schedule: (ReviewScheduleRow & { client_name?: string | null })[] = [],
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  for (const item of items) {
    // Parked is off every clock (0148) and a calendar is a clock. The client's
    // payload already excludes it server-side; the staff page's rows do not,
    // because its own Parked tab needs them — so the rule lives here, where
    // both callers pass through it.
    if (item.state === "parked") continue;
    // A decision is dated by the decision. Only 'approved' and
    // 'changes_requested' carry a decided_at (client_approvals_decided_chk),
    // and a settled row with no stamp at all is an old one — it falls through
    // to its due date rather than off the calendar.
    const settledOn = item.decided_at ? toISODate(new Date(item.decided_at)) : null;
    const date = settledOn ?? item.due_date;
    if (!date) continue;

    entries.push({
      id: item.id,
      date,
      label: item.client_title,
      kind: item.state === "noted" ? "event" : "due",
      late: isOverdue(item),
      done: item.state === "approved",
      // Only the all-clients calendar passes one; a client never sees a name
      // that is not their own, because their payload has no such field.
      clientName: item.client_name ?? null,
    });
  }

  for (const row of schedule) {
    const doneOn = row.completed_at ? toISODate(new Date(row.completed_at)) : null;
    entries.push({
      id: `plan-${row.id}`,
      date: doneOn ?? row.shows_on,
      label: row.label,
      // Ours reads as work in progress, theirs as something with their name on
      // it — the same two marks the queue uses, so the calendar needs no key.
      kind: row.side === "us" ? "task" : "due",
      done: !!doneOn,
      clientName: row.client_name ?? null,
      // Nothing to open: a plan line has no thread, no decision and no page.
      pickable: false,
    });
  }

  return entries;
}

/**
 * "With you 25d · with us 4d" — where the time on this actually went.
 *
 * Both halves, always, whenever either is a day or more. One-sided it is a
 * chase; two-sided it is a record, and it is the same pair of figures the
 * staff page argues from, so the two cannot tell different stories about the
 * same item in the same minute.
 *
 * Whole days from the banked ClickUp totals. The running clock is NOT added
 * back: it is at most half an hour (the sync cron) and this is measured in
 * days. Null when nothing has been linked or nothing has yet reached a day.
 */
export function heldLine(item: ReviewItem): string | null {
  const theirs = Math.floor((item.waiting_ms ?? 0) / 86_400_000);
  const ours = Math.floor((item.our_ms ?? 0) / 86_400_000);
  if (theirs <= 0 && ours <= 0) return null;
  const parts: string[] = [];
  if (theirs > 0) parts.push(`With you ${theirs}d`);
  if (ours > 0) parts.push(`${parts.length ? "with" : "With"} us ${ours}d`);
  return parts.join(" · ");
}

/**
 * One row of "who's holding it up", ready for stopClock and the same
 * RunwayChart staff argue from. Nothing here says where the row came from.
 */
export type HoldingRow = StopClockSource & { id: string; title: string };

/**
 * When something with no linked task landed with whoever owes it.
 *
 * An agreement started when they made it, not when we typed it up. A question
 * started when the email went out. Everything else falls back to the row's own
 * creation. `created_at` alone would date a commitment made in a meeting on
 * the 4th to the day someone got round to recording it.
 */
function heldSince(item: ReviewItem): string {
  return item.agreed_at ?? item.emailed_at ?? item.created_at;
}

/**
 * EVERYTHING OPEN, and whose hands it is sitting in. Three sources, because a
 * client looking at this wants the whole position:
 *
 *   their asks       questions and agreements, which have no ClickUp task and
 *                    so had no clock and no row at all until now
 *   linked tasks     an ask drafted from a brief, carrying ClickUp's clocks
 *   `work`           briefed tasks that never became an ask — the ones staff
 *                    could see and the client could not
 *
 * That last one is the whole reason this function changed. The two sides of
 * this tab read different tables, so a client with seven live tasks and one
 * agreement saw one row. `work` titles are sanitised SERVER-SIDE (ReviewWork),
 * because raw_subject reads "DFT V1.1" and must never cross.
 *
 * Two clocks, one rule for each kind of row:
 *   linked task     ClickUp's own banked totals, and the client's days move
 *                   the due date — that date is our delivery promise, and
 *                   days they held it are days we did not have.
 *   everything else no banked total to read, so the clock runs from the moment
 *                   it landed with them and the whole of it belongs to
 *                   whoever owes it. The date does NOT move: it is the date
 *                   they were asked to hit. See `stop_clock` in stop-clock.ts.
 *
 * Settled items are out. How long something took is our record to keep, not a
 * reproach to keep showing them. Sorting belongs to the caller, which has the
 * clocks: the elapsed time on an unlinked row is not on the row itself.
 */
export function holdingRows(items: ReviewItem[], work: ReviewWork[] = []): HoldingRow[] {
  const rows: HoldingRow[] = [];

  // Briefed work first only in construction order; the caller sorts on the
  // clock. A `done` row never reaches here — the server leaves finished work
  // out, matching the staff tab's Open default and the rule that how long
  // something took is our record, not a reproach.
  for (const w of work) {
    if (w.court === "done") continue;
    rows.push({
      id: w.id,
      title: w.title,
      court: w.court,
      client_wait_ms: w.waiting_ms,
      internal_wait_ms: w.our_ms,
      clickup_status_synced_at: null,
      original_due_date: w.due_date,
      created_at: w.work_since,
      // Points are an internal estimate and never cross the wire; without them
      // the chart simply does not draw the "tight" verdict.
      original_points: null,
      // The client's page is our delivery date on a briefed task, so their
      // days DO move it — the default, and the opposite of an ask they owe.
    });
  }

  for (const item of items) {
    if (item.state !== "pending") continue;
    const base = { id: item.id, title: item.client_title, original_points: null };

    if (item.court && item.work_since) {
      rows.push({
        ...base,
        court: item.court,
        client_wait_ms: item.waiting_ms,
        internal_wait_ms: item.our_ms,
        // No running-clock extrapolation on a linked task: the banked totals
        // are at most half an hour old (the sync cron) and nothing here is
        // finer than a day.
        clickup_status_synced_at: null,
        original_due_date: item.due_date,
        created_at: item.work_since,
      });
      continue;
    }

    // Nothing banked, so the whole elapsed time is the running clock — which
    // is exactly what splitAt does with a zero total and a "synced at" of the
    // moment it landed. One copy of that arithmetic, not a second one here.
    const since = heldSince(item);
    rows.push({
      ...base,
      court: item.owed_by === "us" ? "us" : "client",
      client_wait_ms: 0,
      internal_wait_ms: 0,
      clickup_status_synced_at: since,
      original_due_date: item.due_date,
      created_at: since,
      stop_clock: false,
    });
  }
  return rows;
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
 *
 * Events sit outside all of that — they are a diary, sorted by their date.
 */
export function sortForQueue(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => {
    // Events are a diary, so they read like one: soonest first, oldest last.
    // Without this they fall into the decided branch below, which sorts by a
    // decided_at they will never have and lands them in title order.
    const aNoted = a.state === "noted";
    const bNoted = b.state === "noted";
    if (aNoted && bNoted) {
      return (
        (a.due_date ?? "").localeCompare(b.due_date ?? "") ||
        a.client_title.localeCompare(b.client_title)
      );
    }

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
  // Staff-only. An idea is always parked (0148) and parked rows never cross to
  // a client, so this label is only ever read by the staff table.
  idea: "Idea",
  event: "Date",
};

/**
 * The chip. Two types read differently depending on which way they run: an
 * agreement depends on who made the promise, and a question depends on who
 * asked — "Question" over something the client themselves sent us reads as
 * though we are asking them their own question back.
 */
export function typeLabelFor(item: ReviewItem): string {
  if (item.item_type === "agreement") return item.owed_by === "us" ? "We agreed" : "You agreed";
  if (item.item_type === "question" && item.raised_by === "client") return "You asked";
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
  // Same rule as isOverdue: no countdown on something that is not their move.
  if (item.state !== "pending" || bucketOf(item) !== "your-move") return null;

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
 * "14 Sep", or "14 Sep 2027" when it is not this year — the date on an event.
 *
 * Events sit outside dueStatus entirely: nothing is overdue, nothing is due
 * "in 3 days", because nobody has to do anything. What the row needs is the
 * plain date, which is the whole content of the item. Returns null for
 * anything that is not a dated event, so the caller renders nothing rather
 * than an empty badge.
 */
export function eventDateLabel(item: ReviewItem): string | null {
  if (item.state !== "noted" || !item.due_date) return null;
  const [y, m, d] = item.due_date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
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
      // A question the client asked opens with THEIR bubble, in their name.
      // Rendering it as ours would show them their own words attributed to
      // Converted Click, on the one page whose whole job is to be trustworthy.
      from: item.raised_by === "client" ? "them" : "us",
      author: item.raised_by === "client" ? item.raised_by_name : null,
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

// --- the activity list ----------------------------------------------------

/**
 * The same seven kinds the STAFF panel uses (see TimelineKind in
 * client-timeline.ts), minus `note`. The names are deliberately identical:
 * this list and theirs are meant to be the same list, and two vocabularies for
 * one event is how two screens start telling different stories about the same
 * afternoon.
 */
export type ClientEventKind =
  "asked" | "emailed" | "opened" | "message" | "replied" | "status" | "decided";

/** One entry on an item's activity: a sentence, a time, and the words where
 *  there were any. */
export type ClientEvent = {
  id: string;
  kind: ClientEventKind;
  at: string;
  summary: string;
  /** The message, the ask, or their note on the decision. */
  body?: string | null;
};

/** How an item opens, in the second person. Who started it changes the
 *  sentence entirely — "we asked you this" over something they sent US is
 *  the kind of small lie that costs a page its credibility. */
function openingLine(item: ReviewItem): string {
  const theirs = item.raised_by === "client";
  switch (item.item_type) {
    case "event":
      return theirs ? "You added this date" : "We noted this date";
    case "agreement":
      return item.owed_by === "us" ? "We committed to this" : "Recorded as something you agreed to";
    case "question":
      return theirs ? "You asked us this" : "We asked you this";
    default:
      return "We sent this to you for sign-off";
  }
}

/** What a state change reads as from the client's side of it. */
function moveLine(move: ReviewMove): string | null {
  switch (move.to) {
    case "pending":
      // Naming where it came FROM is what makes a reopen legible: "came to
      // you" alone reads like the first time it was ever sent.
      return move.from === "approved" || move.from === "changes_requested"
        ? "Reopened — back with you"
        : "Came to you";
    case "changes_requested":
      return "Came back to us";
    case "approved":
      return "Closed off";
    case "noted":
      return "Noted as a date";
    default:
      // 'parked' never reaches this page (it is dropped server-side) and an
      // unknown state has no honest sentence. Silence beats a guess.
      return null;
  }
}

/** The line that closes the history. Their decision, in their language. */
function decisionLine(item: ReviewItem): string {
  const who = item.decided_by_name ?? "Someone there";
  if (item.state === "changes_requested") return `${who} sent it back`;
  // A question THEY raised is closed, not answered — by them when they have
  // sorted it, by us when we have. "Answered" would credit an answer that may
  // never have been given, and send someone looking above for it.
  if (item.item_type === "question") {
    return item.raised_by === "client" ? `${who} closed it` : `${who} answered`;
  }
  if (item.item_type === "agreement") return `${who} marked it done`;
  return `${who} approved it`;
}

/**
 * Everything that has happened to one item, oldest first — the client's own
 * copy of the panel staff read beside the preview. ONE list: the words and the
 * events together, because a message and a state change are both just "what
 * happened next", and splitting them into a thread plus a history meant the
 * client had to open two things and reconcile them by timestamp.
 *
 * DELIBERATELY NOT src/lib/client-timeline.ts. That module's header says
 * nothing in it reaches a client, and it means it: it emits internal notes and
 * names the staff member who moved a state. This is the same idea rebuilt from
 * the wire contract, which carries neither — the safety is that the facts a
 * client must not see are not in `item` at all, rather than being filtered out
 * here where a later edit could quietly stop filtering. So the parity has a
 * direction: everything on their list is on ours, never the reverse.
 *
 * The bubbles come from threadOf, which already knows the two rules that are
 * easy to get wrong — a question the client raised opens in THEIR name, and a
 * decision they typed words with joins the list at the moment they decided.
 * The first and last of those become the `asked` and `decided` entries rather
 * than a second copy alongside them.
 *
 * `opens` is client-level (one link opens the whole list), so only opens since
 * this item existed are shown against it — an open from last month says nothing
 * about an ask written yesterday.
 */
export function activityOf(item: ReviewItem, opens: ReviewOpen[] = []): ClientEvent[] {
  const events: ClientEvent[] = threadOf(item).map((m) => {
    if (m.id === `ask-${item.id}`) {
      return { id: m.id, kind: "asked", at: m.at, summary: openingLine(item), body: m.body };
    }
    if (m.id === `decision-${item.id}`) {
      return { id: m.id, kind: "decided", at: m.at, summary: decisionLine(item), body: m.body };
    }
    return {
      id: `msg-${m.id}`,
      kind: m.from === "us" ? "message" : "replied",
      at: m.at,
      summary: m.from === "us" ? "We messaged you" : `${m.author ?? "You"} replied`,
      body: m.body,
    };
  });

  if (item.emailed_at) {
    events.push({
      id: `emailed-${item.id}`,
      kind: "emailed",
      at: item.emailed_at,
      summary: "We emailed it to you",
    });
  }

  for (const open of opens) {
    if (open.at < item.created_at) continue;
    events.push({
      id: `open-${item.id}-${open.name}-${open.at}`,
      kind: "opened",
      at: open.at,
      summary: `${open.name} last opened your page`,
    });
  }

  for (const move of item.moves) {
    const summary = moveLine(move);
    if (!summary) continue;
    events.push({ id: `move-${move.id}`, kind: "status", at: move.at, summary });
  }

  // A decision with no words of its own gets no bubble from threadOf, so it
  // needs its line here. Same trimmed test threadOf uses, or a whitespace-only
  // note would fall through both and the decision would vanish off the list.
  if (item.decided_at && !item.client_note?.trim()) {
    events.push({
      id: `decided-${item.id}`,
      kind: "decided",
      at: item.decided_at,
      summary: decisionLine(item),
    });
  }

  // Stable: equal timestamps keep the order they were pushed in, which is the
  // order the events logically happen (asked before emailed before opened).
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at.localeCompare(b.e.at) || a.i - b.i)
    .map(({ e }) => e);
}
