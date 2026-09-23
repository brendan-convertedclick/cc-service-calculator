// How much of the team's month is accounted for by work Conductor knows about.
//
// Lisa, 2026-09-10: "there are four ppl in the business — vs. hours actually
// worked against the tasks completed … based on normal monday - friday 9am -5pm
// hours ie. 21 days per month on average, 7 hours per day."
//
// COUNTED IN TRACKED HOURS since 2026-09-23. It was points, on the argument
// that time logging was too patchy to measure anybody by; that stopped being
// true, and points had a worse problem — they only exist on briefed, recurring
// and meeting tasks, so a week spent on perpetual work read as almost nothing.
// Brendan's 57 hour week of 14 September showed as 79% of 35. See
// @/hooks/useTeamCapacity for the full argument and for why points survive as
// their own column rather than as the basis.
import { type Period, periodInProgress, workingDaysBetween } from "@/lib/capacity-period";

/** A normal day: 09:00–17:00 less an hour. Lisa's number, not a derived one. */
export const HOURS_PER_WORKING_DAY = 7;

export interface CapacityInput {
  /** The month, week or day being shown. See @/lib/capacity-period. */
  period: Period;
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
  /** Every working hour the team had in the whole period. */
  availableHours: number;
  /** The share of those that have happened yet — equals availableHours once
   *  the period is over. */
  elapsedHours: number;
  accountedHours: number;
  /** Against the whole period. The headline Lisa asked for. */
  pctOfMonth: number;
  /** Against the part of the period that has actually passed — the only fair
   *  read on the 3rd, and identical to pctOfMonth on a finished one. A day
   *  still running has one elapsed working day, not a fraction of one: the
   *  work lands when a task closes, so half a day of clock is not half a day
   *  of capacity. */
  pctOfElapsed: number;
  /** Whether the period is still running; the labels differ if so. */
  inProgress: boolean;
}

export function teamCapacity(
  { period, headcount, accountedHours, today = new Date(), daysOff = { elapsed: 0, total: 0 } }: CapacityInput,
): CapacityResult {
  const inProgress = periodInProgress(period, today);

  // Actual Mon–Fri days, not a flat 21. Twenty-one is the average Lisa quoted
  // and no real month is 21 — August 2026 has 21, September 22 — so the flat
  // figure would quietly misstate every month by a day either way. The same
  // count answers a week (always 5) and a day (1, or 0 on a weekend).
  const totalDays = workingDaysBetween(period.startDate, period.endDate);
  const elapsedDays = inProgress
    ? workingDaysBetween(period.startDate, period.endDate, today)
    : totalDays;

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

/** One person's share. Everyone is assumed full-time — there is nothing in
 *  team_members to say otherwise, and inventing a part-time flag nobody
 *  maintains would make the number less trustworthy, not more. */
export function personCapacityHours(period: Period, today = new Date(), daysOff = 0): number {
  const days = periodInProgress(period, today)
    ? workingDaysBetween(period.startDate, period.endDate, today)
    : workingDaysBetween(period.startDate, period.endDate);
  return Math.max(0, days - daysOff) * HOURS_PER_WORKING_DAY;
}
