// src/lib/stop-clock.ts
//
// The deadline nobody moved.
//
// A thirty-day due date is not thirty days of working time if twenty of them
// were spent waiting for assets. The page used to show the wait and the due
// date as two unrelated facts, so the only thing on screen was "32 days past
// its date" — which reads as us being late even when every one of those days
// was theirs.
//
// One derivation fixes it: THE CLOCK STOPS WHILE THE WORK IS WITH THE CLIENT.
// Add the days they held it back onto the due date and you get the date the
// work is actually due on the terms it was actually run.
//
//   implied due = original_due_date + client_wait_ms
//
// TWO RULES, and both of them are what make it defensible rather than
// self-serving:
//
//   1. ONLY CLIENT-HELD TIME MOVES A DATE. Queue time never does. A deadline
//      that slips because *we* had not started is a deadline nobody believes
//      twice, and one row like that discredits every other row on the page.
//   2. THE ORIGINAL DATE IS STILL SHOWN. `pastDueDays` (how far past its own
//      date it has run) and `lateDays` (what survives once their days come
//      off) are both returned, because showing only the second is an excuse
//      and showing only the first is the bug.
//
// Pure — no network, no React, no implicit Date.now(). `now` is passed in so
// every row on one render agrees and a test can pin it.

import { pointsToHours } from "@/lib/sprint-points";
import { waitSplit, type Court, type WaitingSource } from "@/lib/client-waiting";

const MS_PER_DAY = 86_400_000;

/**
 * A working day, for turning a points estimate into "can we still do it".
 * Six rather than eight: nobody gets eight billable hours out of a day, and
 * an estimate that assumes they do turns every tight call into a false one.
 */
export const WORK_HOURS_PER_DAY = 6;

export type StopClockSource = WaitingSource & {
  /** The due date as at the moment the brief was raised. */
  original_due_date: string | null;
  /** When Conductor learned about it — NOT always when the work was raised. */
  created_at: string;
  original_points: number | null;
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
  const split = waitSplit(row, now);
  const clientDays = split.clientMs / MS_PER_DAY;
  const ourDays = split.internalMs / MS_PER_DAY;

  const dueMs = dueMsOf(row.original_due_date);
  const raisedMs = Date.parse(row.created_at);
  const bornLate = dueMs !== null && !Number.isNaN(raisedMs) && dueMs < raisedMs;
  const runwayDays =
    dueMs === null || bornLate || Number.isNaN(raisedMs)
      ? null
      : Math.round((dueMs - raisedMs) / MS_PER_DAY);

  const impliedDueMs = dueMs === null ? null : dueMs + split.clientMs;
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

export const VERDICT_LABEL: Record<Verdict, string> = {
  delivered: "Delivered",
  "no-date": "No due date",
  ours: "Ours — nothing to ask for",
  extend: "Date gone — extend",
  tight: "Tight — sprint or slip",
  "on-track": "On track once unblocked",
};

/** "3.2d", "12d". One decimal below ten, because 0d reads as nothing. */
export function formatDays(days: number): string {
  return days >= 10 ? `${Math.round(days)}d` : `${Math.round(days * 10) / 10}d`;
}

/** "6 Sep". Formatted in UTC — the underlying value is a bare date. */
export function formatDueDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
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
