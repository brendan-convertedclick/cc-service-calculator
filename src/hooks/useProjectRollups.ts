import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { hoursToPoints } from "@/lib/sprint-points";

export type ProjectRollup = {
  project_id: string;
  budgeted_points: number;
  actual_points: number;
  productized_points: number;
  total_points: number;
};

/**
 * Per-project rollups for the Phase 3 Projects-list metrics.
 *
 * Reads project_actuals_current (hours-based, populated by sync-clickup-actuals)
 * and converts to sprint points. Per-row productized inheritance:
 *   row.is_productized ?? services.is_productized ?? false
 *
 * Implemented in JS rather than as a DB view because the conditional join
 * to services through line_items is non-trivial and the project count is
 * small enough that a single fetch + reduce is fast.
 */
export function useProjectRollups() {
  return useQuery({
    queryKey: ["project-rollups"],
    queryFn: async (): Promise<Map<string, ProjectRollup>> => {
      const { data, error } = await supabase
        .from("project_actuals_current")
        .select("project_id, planned_hours, actual_hours");
      if (error) throw error;

      const map = new Map<string, ProjectRollup>();
      for (const r of data ?? []) {
        if (!r.project_id) continue;
        const existing =
          map.get(r.project_id) ?? {
            project_id: r.project_id,
            budgeted_points: 0,
            actual_points: 0,
            productized_points: 0,
            total_points: 0,
          };
        const bp = hoursToPoints(r.planned_hours ?? 0);
        const ap = hoursToPoints(r.actual_hours ?? 0);
        existing.budgeted_points += bp;
        existing.actual_points += ap;
        // V1 lacks per-task productized flags hooked through line items.
        // Treat all points as non-productized for the % until 0054 + a follow-
        // up join lights this up.
        existing.total_points += bp;
        map.set(r.project_id, existing);
      }
      return map;
    },
  });
}

/**
 * Workspace standard point rate (cents per sprint point).
 */
export function useStandardPointRate() {
  return useQuery({
    queryKey: ["settings", "standard_point_rate_cents"],
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from("settings")
        // @ts-expect-error standard_point_rate_cents added by migration 0054
        .select("standard_point_rate_cents")
        .eq("id", 1)
        .single();
      if (error) throw error;
      // @ts-expect-error see above
      return (data?.standard_point_rate_cents as number | null) ?? null;
    },
  });
}
