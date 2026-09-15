// How much of the team's month is accounted for by work Conductor knows about.
//
// Lisa, 2026-09-10: "there are four ppl in the business — vs. hours actually
// worked against the tasks completed … based on normal monday - friday 9am -5pm
// hours ie. 21 days per month on average, 7 hours per day."
//
// COUNTED IN POINTS, NOT LOGGED TIME, and that is the whole design. "You should
// only be checking points allocated to tasks not time. All tasks briefed in via
// retainers or any type of brief briefed in via Conductor count. Internal too.
// Adhoc, recurring." Time logging is patchy — 108 of August's 181 finished
// briefs carried any — so a capacity view built on logged time would measure
// timer discipline rather than work. Points are on nearly every task and need
// nobody to remember anything.
//
// This is deliberately a DIFFERENT basis from the Retainers page, where
// Completed prefers logged time: that page answers "did we deliver what the fee
// bought", where the real figure is the truer one. Here the question is "what
// was allocated", and the allocation is the points. Same task, two questions,
// and each page says which it is showing.
import { workingDays } from "@/lib/retainer-status";

/** A normal day: 09:00–17:00 less an hour. Lisa's number, not a derived one. */
export const HOURS_PER_WORKING_DAY = 7;

export interface CapacityInput {
  /** "YYYY-MM". */
  month: string;
  /** People available that month. */
  headcount: number;
  /** Hours of work Conductor can account for, in points-derived hours. */
  accountedHours: number;
  /** Injected for tests; defaults to now. */
  today?: Date;
  /** Person-days off in the month (leave, sick, holiday), split into the
   *  part that has passed and the whole month (0172). A day off is not 7h
   *  of capacity. */
  daysOff?: { elapsed: number; total: number };
}

export interface CapacityResult {
  /** Every working hour the team had in the whole month. */
  availableHours: number;
  /** The share of those that have happened yet — equals availableHours once
   *  the month is over. */
  elapsedHours: number;
  accountedHours: number;
  /** Against the whole month. The headline Lisa asked for. */
  pctOfMonth: number;
  /** Against the part of the month that has actually passed — the only fair
   *  read on the 3rd, and identical to pctOfMonth on a finished month. */
  pctOfElapsed: number;
  /** Whether the month is still running; the labels differ if so. */
  inProgress: boolean;
}

export function teamCapacity(
  { month, headcount, accountedHours, today = new Date(), daysOff = { elapsed: 0, total: 0 } }: CapacityInput,
): CapacityResult {
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const inProgress = month === currentMonth;

  // Actual Mon–Fri days, not a flat 21. Twenty-one is the average Lisa quoted
  // and no real month is 21 — August 2026 has 21, September 22 — so the flat
  // figure would quietly misstate every month by a day either way. workingDays
  // already exists for the retainer status badge and is tested there.
  const totalDays = workingDays(month);
  const elapsedDays = inProgress ? workingDays(month, today) : totalDays;

  const availableHours = Math.max(0, totalDays * headcount - daysOff.total) * HOURS_PER_WORKING_DAY;
  const elapsedHours = Math.max(0, elapsedDays * headcount - daysOff.elapsed) * HOURS_PER_WORKING_DAY;

  return {
    availableHours,
    elapsedHours,
    accountedHours,
    pctOfMonth: availableHours > 0 ? (accountedHours / availableHours) * 100 : 0,
    pctOfElapsed: elapsedHours > 0 ? (accountedHours / elapsedHours) * 100 : 0,
    inProgress,
  };
}

/** A ClickUp time entry as the sync stores it on ongoing_actuals: one per
 *  user per task, with the intervals that make it up. */
export interface OngoingTimeEntry {
  user?: { id?: number | string } | null;
  intervals?: Array<{ start?: string | number; end?: string | number; time?: string | number }> | null;
}

/** Hours tracked on a perpetual task inside one month, per ClickUp user id.
 *  A perpetual task never closes, so the month it belongs to is the month the
 *  time was logged in (interval start, local). Lisa, 2026-09-15: the "open
 *  tasks" Rize logs against (Ops Development, Finance, admin) have to reach
 *  capacity, and they have no points, so this is the one bucket on time. */
export function ongoingHoursInMonth(
  entries: OngoingTimeEntry[],
  month: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    const uid = String(e.user?.id ?? "");
    for (const iv of e.intervals ?? []) {
      const start = Number(iv.start ?? 0);
      if (!start) continue;
      const d = new Date(start);
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (m !== month) continue;
      out.set(uid, (out.get(uid) ?? 0) + Number(iv.time ?? 0) / 3_600_000);
    }
  }
  return out;
}

/** One person's share. Everyone is assumed full-time — there is nothing in
 *  team_members to say otherwise, and inventing a part-time flag nobody
 *  maintains would make the number less trustworthy, not more. */
export function personCapacityHours(month: string, today = new Date(), daysOff = 0): number {
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const days = month === currentMonth ? workingDays(month, today) : workingDays(month);
  return Math.max(0, days - daysOff) * HOURS_PER_WORKING_DAY;
}
