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

import { WAITING_STATUSES } from "@/hooks/useSignoffCandidates";

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

export function courtOf(row: WaitingSource): Court {
  const status = (row.clickup_task_status ?? "").toLowerCase();
  if (row.completed_at || DONE_STATUSES.has(status)) return "done";
  return (WAITING_STATUSES as readonly string[]).includes(status) ? "client" : "us";
}

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
  const court = courtOf(row);
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
