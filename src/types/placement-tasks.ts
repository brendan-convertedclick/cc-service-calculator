// Per-quote-line task breakdown row (table placement_tasks, migration 0082).
// One task under a billable brief_task_sow_placements line: a named task tied to
// one department, with a time allocation (hours) and sprint points.
export type PlacementTask = {
  id: string;
  brief_id: string;
  placement_id: string;
  title: string;
  department_id: string | null;
  hours: number;
  points: number;
  // true once the ops manager edits points directly — hours changes no longer reseed it.
  points_overridden: boolean;
  sort_order: number;
  ai_generated: boolean;
  // Stamped by schedule-brief-tasks when the task is pushed to ClickUp
  // (migration 0085); doubles as the push-idempotency guard.
  clickup_task_id: string | null;
  clickup_task_url: string | null;
  created_at: string;
  updated_at: string;
};

/** Sprint-point convention: 1 point = 15 minutes → 4 points per hour. */
export const POINTS_PER_HOUR = 4;

/** Points auto-derived from an hours figure (rounded to 2dp). */
export function pointsFromHours(hours: number): number {
  return Math.round(hours * POINTS_PER_HOUR * 100) / 100;
}
