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

/**
 * From a retainer's provisioned_tasks rows, produce the project_actuals seed
 * entries for tasks whose period covers `today` and that aren't already tracked
 * in project_actuals_current. Deduped across rows.
 *
 * planned_hours is derived from the recurring service's points and is
 * informational only — retainer burn uses projects.retainer_hours_target,
 * not per-task planned_hours.
 */
export function collectProvisionedActuals(
  existingTaskIds: Set<string>,
  rows: ProvisionedPeriodRow[],
  today: string,
): SyntheticActual[] {
  const out: SyntheticActual[] = [];
  const seen = new Set<string>(existingTaskIds);
  for (const row of rows) {
    if (today < row.period_start || today > row.period_end) continue;
    const plannedHours = ((row.points_per_occurrence ?? 0) * MIN_PER_POINT) / 60;
    for (const taskId of row.clickup_task_ids ?? []) {
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      out.push({ clickup_task_id: taskId, dept_id: null, planned_hours: plannedHours });
    }
  }
  return out;
}
