import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// One provisioned ClickUp task under a retainer, joined with its latest
// synced actuals. usedHours/status are null until the first sync touches
// the task (the row then comes from project_actuals_current).
export interface RetainerSubItem {
  taskId: string;
  serviceName: string;
  assigneeName: string | null;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  estimatedHours: number | null;
  usedHours: number | null;
  status: string | null; // raw ClickUp status at last sync
  isDone: boolean;
}

export interface ProvisionedTaskRow {
  clickup_task_ids: string[] | null;
  period_start: string;
  period_end: string;
  retainer_recurring_services: {
    points_per_occurrence: number | null;
    services: { name: string } | null;
  } | null;
  team_members: { full_name: string } | null;
}

export interface SubItemActualRow {
  clickup_task_id: string;
  planned_hours: number | null;
  actual_hours: number | null;
  status_at_sync: string | null;
}

// Same closed-status set the sync uses for the project "all done" rollup
// (supabase/functions/sync-clickup-actuals/index.ts).
const DONE_STATUSES = new Set(["complete", "closed", "done"]);

const MIN_PER_POINT = 15; // 1 sprint point = 15 minutes

/**
 * Flatten provisioned_tasks rows (one per assignee × service × period, each
 * holding N ClickUp task ids) into displayable sub-items, joined with the
 * latest actuals snapshot per task. Estimated hours prefer the synced
 * planned_hours and fall back to the recurring service's points.
 */
export function combineSubItems(
  provisioned: ProvisionedTaskRow[],
  actuals: SubItemActualRow[],
): RetainerSubItem[] {
  const byTask = new Map(actuals.map((a) => [a.clickup_task_id, a]));
  const seen = new Set<string>();
  const out: RetainerSubItem[] = [];
  for (const row of provisioned) {
    const points = row.retainer_recurring_services?.points_per_occurrence ?? null;
    const fallbackEstimate = points != null ? (points * MIN_PER_POINT) / 60 : null;
    for (const taskId of row.clickup_task_ids ?? []) {
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      const actual = byTask.get(taskId);
      const status = actual?.status_at_sync ?? null;
      out.push({
        taskId,
        serviceName:
          row.retainer_recurring_services?.services?.name ?? "Recurring service",
        assigneeName: row.team_members?.full_name ?? null,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        estimatedHours: actual?.planned_hours ?? fallbackEstimate,
        usedHours: actual ? (actual.actual_hours ?? 0) : null,
        status,
        isDone: status != null && DONE_STATUSES.has(status),
      });
    }
  }
  return out;
}

export function useRetainerSubItems(projectId: string) {
  return useQuery({
    queryKey: ["retainerSubItems", projectId],
    queryFn: async (): Promise<RetainerSubItem[]> => {
      // provisioned_tasks / retainer_recurring_services aren't in the
      // generated Database types yet (Phase 8) — query untyped and cast rows.
      const sb = supabase as unknown as SupabaseClient;
      const [prov, act] = await Promise.all([
        sb
          .from("provisioned_tasks")
          .select(
            "clickup_task_ids, period_start, period_end, retainer_recurring_services(points_per_occurrence, services(name)), team_members(full_name)",
          )
          .eq("project_id", projectId)
          .order("period_start", { ascending: false }),
        sb
          .from("project_actuals_current")
          .select("clickup_task_id, planned_hours, actual_hours, status_at_sync")
          .eq("project_id", projectId),
      ]);
      if (prov.error) throw prov.error;
      if (act.error) throw act.error;
      return combineSubItems(
        (prov.data ?? []) as unknown as ProvisionedTaskRow[],
        (act.data ?? []) as unknown as SubItemActualRow[],
      );
    },
  });
}
