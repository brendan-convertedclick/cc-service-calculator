import type { Database } from "@/types/db";

type ProjectStatus = Database["public"]["Enums"]["project_status"];
type Actual = Database["public"]["Views"]["project_actuals_current"]["Row"];

export type DerivedStatus = "backlog" | "in_progress" | "complete" | "cancelled" | "archived";

const COMPLETE_STATUSES = new Set(["complete", "closed", "done"]);
const NOT_STARTED_STATUSES = new Set(["to do", "todo", "open", "backlog", ""]);

export const STATUS_LABEL: Record<DerivedStatus, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
  archived: "Archived",
};

export interface ProjectProgress {
  taskTotal: number;
  taskComplete: number;
  taskPct: number;
  plannedHours: number;
  actualHours: number;
  timePct: number;
}

export function computeProjectProgress(actuals: Pick<Actual, "status_at_sync" | "planned_hours" | "actual_hours">[]): ProjectProgress {
  let taskTotal = 0;
  let taskComplete = 0;
  let plannedHours = 0;
  let actualHours = 0;

  for (const a of actuals) {
    taskTotal += 1;
    const status = (a.status_at_sync ?? "").toLowerCase();
    if (COMPLETE_STATUSES.has(status)) taskComplete += 1;
    plannedHours += Number(a.planned_hours ?? 0);
    actualHours += Number(a.actual_hours ?? 0);
  }

  const taskPct = taskTotal === 0 ? 0 : taskComplete / taskTotal;
  const timePct = plannedHours === 0 ? 0 : actualHours / plannedHours;

  return { taskTotal, taskComplete, taskPct, plannedHours, actualHours, timePct };
}

export function deriveProjectStatus(
  storedStatus: ProjectStatus,
  progress: ProjectProgress,
): DerivedStatus {
  if (storedStatus === "archived") return "archived";
  if (storedStatus === "cancelled") return "cancelled";
  if (storedStatus === "completed") return "complete";
  if (progress.taskTotal === 0) return "backlog";
  if (progress.taskComplete === progress.taskTotal) return "complete";

  // Any task that's started (not in a not-started bucket) → in_progress.
  // taskComplete > 0 obviously qualifies. Otherwise check if any in-flight.
  if (progress.taskComplete > 0) return "in_progress";
  return "backlog";
}

export function deriveProjectStatusFromActuals(
  storedStatus: ProjectStatus,
  actuals: Pick<Actual, "status_at_sync" | "planned_hours" | "actual_hours">[],
): { status: DerivedStatus; progress: ProjectProgress } {
  const progress = computeProjectProgress(actuals);

  if (storedStatus === "archived") return { status: "archived", progress };
  if (storedStatus === "cancelled") return { status: "cancelled", progress };
  if (storedStatus === "completed") return { status: "complete", progress };
  if (progress.taskTotal === 0) return { status: "backlog", progress };
  if (progress.taskComplete === progress.taskTotal) return { status: "complete", progress };

  const anyStarted = actuals.some((a) => {
    const s = (a.status_at_sync ?? "").toLowerCase();
    return !NOT_STARTED_STATUSES.has(s) && !COMPLETE_STATUSES.has(s);
  });

  return {
    status: progress.taskComplete > 0 || anyStarted ? "in_progress" : "backlog",
    progress,
  };
}
