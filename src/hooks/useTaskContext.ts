import { useQuery } from "@tanstack/react-query";
import { callEdgeFn } from "@/lib/edge";

export type TaskContext = {
  id: string;
  name: string;
  url: string;
  description: string | null;
  status: string | null;
  list_name: string | null;
  assignees: string[];
  due_date: number | null;
  date_created: number | null;
  original_points: number | null;
  time_estimate_ms: number | null;
  time_spent_ms: number;
  points_consumed: number;
};

/**
 * Live ClickUp state for one task — budget, spend, description.
 *
 * Shared cache on purpose: the escalations rail shows the consumed % for every
 * request in the queue and the detail pane shows the full record for the
 * selected one. Keyed by task id, react-query collapses those into a single
 * round trip per task instead of one per component.
 */
export function useTaskContext(taskId: string | null | undefined) {
  return useQuery({
    enabled: !!taskId,
    queryKey: ["clickup-task-context", taskId],
    // ClickUp time entries change slowly relative to an approval session.
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<TaskContext> => {
      const body = await callEdgeFn<{ context?: TaskContext; error?: string }>(
        "get-clickup-task-context",
        { task_id: taskId },
      );
      if (!body.context) {
        throw new Error(body.error ?? "Could not load task context");
      }
      return body.context;
    },
  });
}

/** Percentage of the task's point budget already consumed. */
export function consumedPct(ctx: TaskContext | undefined): number | null {
  if (!ctx || ctx.original_points === null || ctx.original_points <= 0) return null;
  return Math.round((ctx.points_consumed / ctx.original_points) * 100);
}
