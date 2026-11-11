// src/lib/client-waiting.ts
//
// Who is holding a task up, and for how long.
//
// The argument this exists to settle: a client says the work was late; we say
// they sat on the answer for three weeks. Neither side has a number, so the
// loudest opinion wins. ClickUp already holds the evidence — every minute a
// task spent in each status — and sync-clickup-actuals banks two running
// totals per brief:
//
//   client_wait_ms    time in a status that is the CLIENT's court
//   internal_wait_ms  time in a status that is OURS
//
// Both are cumulative and both are STALE: they are true as at
// clickup_status_synced_at, which is a 30-minute cron. The clock that is
// currently running has to be added back here, or a task that went to the
// client an hour ago reads as zero and the page looks broken.
//
// Pure. No network, no React, no Date.now() default that a test can't pin.

import {
  courtOf,
  splitAt,
  type Court,
  type WaitingSource,
  type WaitSplit,
} from "../../supabase/functions/_shared/stop-clock";

// The court and the clock arithmetic live in _shared so the Deno edge functions
// run the same ones; importers of this module are unchanged.
export { courtOf, splitAt, type Court, type WaitingSource, type WaitSplit };

/**
 * The two clocks as at `now`, with the running one extrapolated forward from
 * the last sync.
 *
 * The extrapolation is added to whichever side currently holds the task, and
 * only while it is open. It is capped at nothing and floored at zero: a
 * clock-skewed `synced_at` in the future must not subtract time from a total
 * we are about to show a client.
 */
export function waitSplit(row: WaitingSource, now: number): WaitSplit {
  return splitAt(courtOf(row), row, now);
}

/**
 * "2d 4h", "5h", "40m", "—". Days and hours only past a day, because nobody
 * arguing about a three-week delay cares about the minutes.
 */
export function formatWait(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

/**
 * The share of the open waiting time that belongs to the client, 0–1, or null
 * when nothing has been waited at all. Used to shade the row: a task that is
 * 90% client-wait should not look the same as one that is 90% ours.
 */
export function clientShare(split: WaitSplit): number | null {
  const total = split.clientMs + split.internalMs;
  return total > 0 ? split.clientMs / total : null;
}
