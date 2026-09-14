// Pure logic for folding retainer provisioned tasks into the actuals sync.
// No Deno/Supabase imports — unit-testable in isolation.

export interface ProvisionedPeriodRow {
  clickup_task_ids: string[];
  period_start: string; // ISO date, inclusive
  period_end: string;   // ISO date, inclusive
  points_per_occurrence: number | null;
}

export interface SyntheticActual {
  clickup_task_id: string;
  dept_id: null;
  planned_hours: number;
}

const MIN_PER_POINT = 15; // 1 sprint point = 15 minutes (see supabase/functions/provision-retainer-period/index.ts)

/** `iso` (YYYY-MM-DD) moved back `months` whole months, as YYYY-MM-DD. */
export function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Day 1 avoids the 31st-of-a-30-day-month rollover; only the month matters
  // here, and periods are whole months.
  const back = new Date(Date.UTC(y, m - 1 - months, 1));
  const day = String(d).padStart(2, "0");
  return `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, "0")}-${day}`;
}

/**
 * From a retainer's provisioned_tasks rows, produce the project_actuals seed
 * entries for tasks that aren't already tracked in project_actuals_current.
 * Deduped across rows.
 *
 * SEEDING IS THE ONLY DOOR IN. Once a task has a project_actuals row the sync
 * re-fetches it from ClickUp every tick forever; until it has one, nothing
 * looks at it. This used to require the period to cover TODAY, so a task the
 * sync missed during its own month could never be picked up again — and 73 of
 * them had been missed, 60 in August alone, which is 45% of that month's
 * provisioned work. Since 0161 the Retainers page reads Scheduled off these
 * rows, so each miss showed as an em dash on a month that really did have work
 * scheduled in it (Dovetail Paid Media: June 2.5h, July 0.5h, August —, and
 * September 3h).
 *
 * So a period that has STARTED is eligible, however long ago, bounded by
 * `lookbackMonths` — the catch-up is two ClickUp calls per task in a sequential
 * loop, and this function is what stops an unbounded backlog turning one tick
 * into a rate-limit storm. A future period is still skipped: its tasks exist
 * but nothing has happened in them yet.
 *
 * planned_hours is derived from the recurring service's points, and the sync
 * writes it through unchanged rather than taking ClickUp's estimate — so this
 * is where the Scheduled column's hours actually come from. It is no longer
 * "informational only": that comment predated 0161.
 */
export function collectProvisionedActuals(
  existingTaskIds: Set<string>,
  rows: ProvisionedPeriodRow[],
  today: string,
  lookbackMonths = 6,
): SyntheticActual[] {
  const out: SyntheticActual[] = [];
  const seen = new Set<string>(existingTaskIds);
  const cutoff = monthsBefore(today, lookbackMonths);
  for (const row of rows) {
    if (today < row.period_start) continue;
    if (row.period_end < cutoff) continue;
    const plannedHours = ((row.points_per_occurrence ?? 0) * MIN_PER_POINT) / 60;
    for (const taskId of row.clickup_task_ids ?? []) {
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      out.push({ clickup_task_id: taskId, dept_id: null, planned_hours: plannedHours });
    }
  }
  return out;
}
