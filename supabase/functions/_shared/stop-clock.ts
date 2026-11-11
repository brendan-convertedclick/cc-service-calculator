// supabase/functions/_shared/stop-clock.ts
//
// The stop clock and everything it stands on: whose court a task is in, how the
// two wait clocks split, and the rows "who is holding it up" is drawn from.
// Shared so Vite (src/lib/stop-clock.ts, client-waiting.ts, client-review.ts
// re-export it) and Deno (the stitch-waiting edge function) run one definition.
//
// NO IMPORTS, on purpose, including none between the _shared files: Vite
// imports this extensionless and Deno imports it with `.ts`, and an import in
// here would have to satisfy both resolvers. Rationale for the rules is in
// src/lib/stop-clock.ts.

export const MINS_PER_POINT = 15;
export const POINTS_PER_HOUR = 60 / MINS_PER_POINT; // 4

export function pointsToHours(points: number): number {
  return points / POINTS_PER_HOUR;
}

/** ClickUp statuses that mean the ball is in the client's court. */
export const WAITING_STATUSES = ["waiting on client", "send to client"] as const;

/** ClickUp statuses that mean the work is finished and nobody is waiting. */
const DONE_STATUSES = new Set(["complete", "closed", "done"]);

/** Whose move it is right now. `done` is not a delay — the work landed. */
export type Court = "client" | "us" | "done";

/** The fields of a brief this module reasons about. Deliberately narrow. */
export type WaitingSource = {
  clickup_task_status: string | null;
  clickup_status_synced_at: string | null;
  client_wait_ms: number | null;
  internal_wait_ms: number | null;
  completed_at: string | null;
};

export type WaitSplit = {
  court: Court;
  /** Banked + the clock still running, in ms. */
  clientMs: number;
  internalMs: number;
};

export function courtOf(
  // Narrower than WaitingSource on purpose: the court is a fact about the
  // status, and the client-facing payload carries no clocks-synced timestamp.
  row: Pick<WaitingSource, "clickup_task_status" | "completed_at">,
): Court {
  const status = (row.clickup_task_status ?? "").toLowerCase();
  if (row.completed_at || DONE_STATUSES.has(status)) return "done";
  return (WAITING_STATUSES as readonly string[]).includes(status) ? "client" : "us";
}

/**
 * The clock arithmetic on its own, once the court is known.
 *
 * Split out because the client's page reasons about the same two clocks but
 * has no ClickUp status to derive a court from — it is handed one on the wire.
 * One copy of "add the running clock to whoever is holding it", not two.
 */
export function splitAt(
  court: Court,
  row: Pick<WaitingSource, "client_wait_ms" | "internal_wait_ms" | "clickup_status_synced_at">,
  now: number,
): WaitSplit {
  let clientMs = Math.max(0, row.client_wait_ms ?? 0);
  let internalMs = Math.max(0, row.internal_wait_ms ?? 0);

  if (court !== "done" && row.clickup_status_synced_at) {
    const since = new Date(row.clickup_status_synced_at).getTime();
    const running = Number.isNaN(since) ? 0 : Math.max(0, now - since);
    if (court === "client") clientMs += running;
    else internalMs += running;
  }

  return { court, clientMs, internalMs };
}

const MS_PER_DAY = 86_400_000;

/**
 * A working day, for turning a points estimate into "can we still do it".
 * Six rather than eight: nobody gets eight billable hours out of a day, and
 * an estimate that assumes they do turns every tight call into a false one.
 */
export const WORK_HOURS_PER_DAY = 6;

export type StopClockSource = Omit<WaitingSource, "clickup_task_status" | "completed_at"> & {
  /**
   * Whose court it is in, already decided. Taking the court rather than the
   * raw ClickUp status is what lets the CLIENT's page draw the same chart:
   * their payload carries a derived court and no status string, because a
   * status is our vocabulary — see types/client-review.ts.
   */
  court: Court;
  /** The due date as at the moment the brief was raised. */
  original_due_date: string | null;
  /** When Conductor learned about it — NOT always when the work was raised. */
  created_at: string;
  original_points: number | null;
  /**
   * Does the client's time move THIS date? Defaults true, which is every
   * briefed task: the date is our delivery promise, and days they held it are
   * days we did not have.
   *
   * False for a thing the CLIENT owes — an agreement they made, a question we
   * asked them. Its due date is the date THEY were asked to hit, so adding
   * their own lateness back onto it is circular: the item would report "2d in
   * hand" on the same screen where the queue calls it 14 days overdue.
   */
  stop_clock?: boolean;
};

/**
 * What to do about it. `delivered` is history; the other five are a live
 * position, and three of them want a decision from a person.
 */
export type Verdict = "delivered" | "no-date" | "ours" | "extend" | "tight" | "on-track";

export type StopClock = {
  court: Court;
  clientMs: number;
  internalMs: number;
  clientDays: number;
  ourDays: number;

  /** Midnight-UTC ms of `original_due_date`, or null. */
  dueMs: number | null;
  /**
   * Days between the work being raised and being due — the time we were
   * given. Null when it cannot be known, which is either no due date or
   * `bornLate`.
   */
  runwayDays: number | null;
  /**
   * The due date is earlier than the row's own created_at. Sign-offs drafted
   * from an existing ClickUp task carry that task's original date, so
   * `created_at` is when Conductor found out, not when the clock started.
   * There is no runway to measure on these and we must not invent one.
   */
  bornLate: boolean;
  /**
   * Where the work's own start sits relative to its due date, in days.
   * Negative is runway: we were told before it was due. POSITIVE is the
   * born-late gap, and those days belong to NOBODY — the date had already
   * passed when the task was created, so no clock was running through them.
   *
   * It exists so a chart can put the bar where the time actually was. Drawing
   * a born-late row from the due line implies someone held it for the whole
   * overrun, when in truth the task is two hours old and the deadline was
   * back-dated three weeks.
   */
  startDays: number | null;

  /** due + client-held time. Grows in real time while they still hold it. */
  impliedDueMs: number | null;
  /** How far past its own due date, in days. 0 when not past it. */
  pastDueDays: number;
  /** What is left of that once their days come off. 0 when not late. */
  lateDays: number;
  /** Days of the adjusted deadline still in hand. Negative means gone. */
  daysInHand: number | null;

  /** The estimate, in hours. Null when the task carries no points. */
  workHours: number | null;
  verdict: Verdict;
};

/** "2026-07-30" -> midnight UTC ms. Never `new Date(str)` on a bare date. */
function dueMsOf(date: string | null): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

export function stopClock(row: StopClockSource, now: number): StopClock {
  const split = splitAt(row.court, row, now);
  const clientDays = split.clientMs / MS_PER_DAY;
  const ourDays = split.internalMs / MS_PER_DAY;

  const dueMs = dueMsOf(row.original_due_date);
  const raisedMs = Date.parse(row.created_at);
  const bornLate = dueMs !== null && !Number.isNaN(raisedMs) && dueMs < raisedMs;
  const runwayDays =
    dueMs === null || bornLate || Number.isNaN(raisedMs)
      ? null
      : Math.round((dueMs - raisedMs) / MS_PER_DAY);
  const startDays =
    dueMs === null || Number.isNaN(raisedMs) ? null : (raisedMs - dueMs) / MS_PER_DAY;

  const impliedDueMs =
    dueMs === null ? null : dueMs + (row.stop_clock === false ? 0 : split.clientMs);
  const pastDueDays = dueMs === null ? 0 : Math.max(0, (now - dueMs) / MS_PER_DAY);
  const lateDays = impliedDueMs === null ? 0 : Math.max(0, (now - impliedDueMs) / MS_PER_DAY);
  const daysInHand = impliedDueMs === null ? null : (impliedDueMs - now) / MS_PER_DAY;

  const workHours = row.original_points == null ? null : pointsToHours(row.original_points);

  return {
    court: split.court,
    clientMs: split.clientMs,
    internalMs: split.internalMs,
    clientDays,
    ourDays,
    dueMs,
    runwayDays,
    bornLate,
    startDays,
    impliedDueMs,
    pastDueDays,
    lateDays,
    daysInHand,
    workHours,
    verdict: verdictOf({ court: split.court, dueMs, clientDays, pastDueDays, daysInHand, workHours }),
  };
}

/**
 * The fork, in the order the states actually rule each other out.
 *
 * `ours` is deliberately checked before anything involving the implied date:
 * a task that is past its date with no client wait behind it gets no
 * adjustment and no extension to ask for, and saying so plainly is the only
 * reason the rows that DO get an adjustment are believable.
 */
function verdictOf(a: {
  court: Court;
  dueMs: number | null;
  clientDays: number;
  pastDueDays: number;
  daysInHand: number | null;
  workHours: number | null;
}): Verdict {
  if (a.court === "done") return "delivered";
  if (a.dueMs === null) return "no-date";
  if (a.clientDays < 0.5 && a.pastDueDays > 0) return "ours";
  if (a.daysInHand === null) return "no-date";
  if (a.daysInHand < 0) return "extend";
  const workDays = (a.workHours ?? 0) / WORK_HOURS_PER_DAY;
  return a.daysInHand < workDays ? "tight" : "on-track";
}

/** "3.2d", "12d". One decimal below ten, because 0d reads as nothing. */
export function formatDays(days: number): string {
  return days >= 10 ? `${Math.round(days)}d` : `${Math.round(days * 10) / 10}d`;
}

/**
 * The one line the whole page exists to produce: how many days of deadline a
 * client's silence has cost, and where the earliest at-risk date now sits.
 *
 * Only rows whose date actually moved are counted. A task nobody is waiting
 * on contributes nothing, and rows that are late on us are counted
 * separately — a summary that can only blame the client gets believed once.
 *
 * `leadIndex` is THE ROW THAT LOST THE MOST, not the one with the soonest
 * date. Soonest was the obvious choice and it is wrong here: a sign-off
 * drafted from an old ClickUp task inherits a due date that has already
 * passed, so `bornLate` rows always hold the soonest adjusted date and would
 * permanently own the headline with a date nobody set and a movement of three
 * days. The biggest movement is both the strongest exhibit and the one the
 * headline number is actually about.
 */
export function summariseStopClocks(clocks: StopClock[]): {
  daysLost: number;
  moved: number;
  lateOnUs: number;
  /** Index into `clocks` of the row driving the headline, or null. */
  leadIndex: number | null;
} {
  let daysLost = 0;
  let moved = 0;
  let lateOnUs = 0;
  let leadIndex: number | null = null;
  let leadDays = 0;

  clocks.forEach((c, i) => {
    if (c.court === "done") return;
    if (c.verdict === "ours") lateOnUs += 1;
    if (c.clientDays < 0.5 || c.impliedDueMs === null) return;
    // A row whose date does not move contributes no lost deadline, however
    // long they have held it. Their own overdue commitment is not a deadline
    // of ours that their silence ate.
    if (c.impliedDueMs === c.dueMs) return;
    daysLost += c.clientDays;
    moved += 1;
    // A row whose date had already passed when it was raised is not evidence
    // of anything; it never leads, though its days still count.
    if (c.bornLate) return;
    if (c.clientDays > leadDays) {
      leadDays = c.clientDays;
      leadIndex = i;
    }
  });

  return { daysLost, moved, lateOnUs, leadIndex };
}

/**
 * One row of "who's holding it up", ready for stopClock and the same
 * RunwayChart staff argue from. Nothing here says where the row came from.
 */
export type HoldingRow = StopClockSource & { id: string; title: string };

/** The fields of a sign-off `holdingRows` reads. ReviewItem satisfies it. */
type HoldingItem = {
  id: string;
  client_title: string;
  state: string;
  owed_by: "client" | "us";
  court: Court | null;
  work_since: string | null;
  waiting_ms: number | null;
  our_ms: number | null;
  due_date: string | null;
  agreed_at: string | null;
  emailed_at: string | null;
  created_at: string;
};

/** The fields of briefed work `holdingRows` reads. ReviewWork satisfies it. */
type HoldingWork = {
  id: string;
  title: string;
  court: Court;
  waiting_ms: number | null;
  our_ms: number | null;
  work_since: string;
  due_date: string | null;
};

/**
 * When something with no linked task landed with whoever owes it.
 *
 * An agreement started when they made it, not when we typed it up. A question
 * started when the email went out. Everything else falls back to the row's own
 * creation. `created_at` alone would date a commitment made in a meeting on
 * the 4th to the day someone got round to recording it.
 */
function heldSince(item: Pick<HoldingItem, "agreed_at" | "emailed_at" | "created_at">): string {
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
export function holdingRows(items: HoldingItem[], work: HoldingWork[] = []): HoldingRow[] {
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
