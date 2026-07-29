// Sprint-point arithmetic. 1 sprint point = 15 minutes.
//   hours × MINS_PER_HOUR / MINS_PER_POINT = points
//   hours × 4 = points

export const MINS_PER_POINT = 15;
export const POINTS_PER_HOUR = 60 / MINS_PER_POINT; // 4

export function hoursToPoints(hours: number): number {
  return hours * POINTS_PER_HOUR;
}

export function pointsToHours(points: number): number {
  return points / POINTS_PER_HOUR;
}

/**
 * Maximum sprint points a project can spend before it loses money outright.
 *   max_points = project_value_cents / standard_point_rate_cents
 * Returns null if either input is missing or invalid (rate of 0).
 */
export function maxPointsFromValue(
  projectValueCents: number | null | undefined,
  standardPointRateCents: number | null | undefined,
): number | null {
  if (!projectValueCents || !standardPointRateCents) return null;
  if (standardPointRateCents <= 0) return null;
  return projectValueCents / standardPointRateCents;
}

export type ProgressState = "ok" | "warn" | "over";

/**
 * Classify a project's burn state from actual / budgeted / max points.
 *   actual ≤ budgeted               → 'ok'
 *   budgeted < actual ≤ max         → 'warn'
 *   actual > max (or no max)        → 'over'
 */
export function classifyProgress(
  actualPoints: number,
  budgetedPoints: number,
  maxPoints: number | null,
): ProgressState {
  if (actualPoints <= budgetedPoints) return "ok";
  if (maxPoints !== null && actualPoints <= maxPoints) return "warn";
  return "over";
}

/**
 * Pct of productized work, weighted by sprint points. Returns null if no
 * points present.
 */
export function productizedPct(
  productizedPoints: number,
  totalPoints: number,
): number | null {
  if (totalPoints <= 0) return null;
  return Math.round((productizedPoints / totalPoints) * 1000) / 10;
}

/**
 * Points with their hour equivalent, points first: "10 pt · 2.5h". The two
 * units travel together everywhere they're shown to an approver — points are
 * what work is briefed in, hours are what it costs.
 */
export function fmtPtH(points: number | string | null | undefined): string {
  if (points === null || points === undefined) return "—";
  const n = Number(points);
  if (!Number.isFinite(n)) return "—";
  const h = pointsToHours(n);
  const hours = h >= 1 ? `${Math.round(h * 10) / 10}h` : `${Math.round(h * 60)}m`;
  return `${n} pt · ${hours}`;
}
