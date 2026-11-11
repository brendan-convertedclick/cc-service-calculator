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

import type { Verdict } from "../../supabase/functions/_shared/stop-clock";

// The derivation itself lives in _shared so the Deno edge functions run the same
// one. Everything below is the presentation half: labels and date formatting.
export {
  formatDays,
  stopClock,
  summariseStopClocks,
  WORK_HOURS_PER_DAY,
  type StopClock,
  type StopClockSource,
  type Verdict,
} from "../../supabase/functions/_shared/stop-clock";

export const VERDICT_LABEL: Record<Verdict, string> = {
  delivered: "Delivered",
  "no-date": "No due date",
  ours: "Ours — nothing to ask for",
  extend: "Date gone — extend",
  tight: "Tight — sprint or slip",
  "on-track": "On track once unblocked",
};

/** "6 Sep". Formatted in UTC — the underlying value is a bare date. */
export function formatDueDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
