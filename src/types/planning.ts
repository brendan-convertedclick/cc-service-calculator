export type TrackingMode = "live" | "manual";

export type Cadence = "daily" | "weekly" | "biweekly" | "monthly" | "custom";

export type RetainerRecurringService = {
  id: string;
  project_id: string;
  service_id: string;
  cadence: Cadence;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
  created_at: string;
};

export type ProvisionedTaskRow = {
  id: string;
  project_id: string;
  recurring_service_id: string;
  assignee_id: string;
  period_start: string;
  period_end: string;
  mode: TrackingMode;
  clickup_task_ids: string[];
  created_at: string;
};

/**
 * Compute the discrete-task dates for a given period + cadence + occurrence
 * count. Used by the manual-mode provisioner to seed N dated ClickUp tasks.
 *
 * Approximation: dates are spread evenly across business days in the
 * period. The first task lands on period_start (or the next business day).
 *
 * For 'daily' cadence, returns up to one per business day in the period
 * (capped by occurrences_per_month).
 */
export function plannedTaskDates(
  periodStart: Date,
  periodEnd: Date,
  cadence: Cadence,
  occurrencesPerMonth: number,
): Date[] {
  const out: Date[] = [];
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();
  if (endMs < startMs) return out;
  const target = Math.max(1, Math.round(occurrencesPerMonth));

  if (cadence === "daily") {
    let d = new Date(periodStart);
    while (d.getTime() <= endMs && out.length < target) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) out.push(new Date(d));
      d = nextDay(d);
    }
    return out;
  }

  // Spread evenly across the period.
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
  const stride = Math.max(1, Math.floor(totalDays / target));
  let d = new Date(periodStart);
  while (out.length < target && d.getTime() <= endMs) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
    d = new Date(d.getTime() + stride * 86_400_000);
  }
  return out;
}

function nextDay(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + 1);
  return r;
}

/**
 * Whether a given tracking mode should produce a perpetual live task vs N
 * discrete dated tasks. Live mode honors per-service eligibility.
 */
export function provisionMode(
  memberMode: TrackingMode,
  serviceLiveEligible: boolean,
): TrackingMode {
  if (memberMode === "live" && serviceLiveEligible) return "live";
  return "manual";
}
