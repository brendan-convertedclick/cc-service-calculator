// src/hooks/usePlacementTasks.ts
//
// Data layer for the per-quote-line task breakdown (Stage 3 of the brief flow).
// Rows live in placement_tasks (migration 0082), keyed to a billable
// brief_task_sow_placements line. Not in the generated Database types yet —
// query untyped and cast (same pattern as useScopeMap).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { PlacementTask } from "@/types/placement-tasks";

const sb = supabase as unknown as SupabaseClient;

export const LINE_TASKS_KEY = (briefId: string) => ["placement-tasks", briefId] as const;

// numeric columns can arrive as strings from PostgREST — coerce to numbers.
function coerce(row: Record<string, unknown>): PlacementTask {
  return {
    ...(row as unknown as PlacementTask),
    hours: Number(row.hours) || 0,
    points: Number(row.points) || 0,
  };
}

export function useLineTasks(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: briefId ? LINE_TASKS_KEY(briefId) : ["placement-tasks", "none"],
    queryFn: async (): Promise<PlacementTask[]> => {
      if (!briefId) return [];
      const { data, error } = await sb
        .from("placement_tasks")
        .select("*")
        .eq("brief_id", briefId)
        .order("placement_id")
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map(coerce);
    },
  });
}

export type NewLineTask = {
  placement_id: string;
  title?: string;
  department_id?: string | null;
  hours?: number;
  points?: number;
  sort_order?: number;
};

export function useAddLineTask(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewLineTask): Promise<PlacementTask> => {
      if (!briefId) throw new Error("Missing brief id");
      const { data, error } = await sb
        .from("placement_tasks")
        .insert({ brief_id: briefId, ...input })
        .select()
        .single();
      if (error) throw error;
      return coerce(data);
    },
    onSuccess: () => {
      if (briefId) qc.invalidateQueries({ queryKey: LINE_TASKS_KEY(briefId) });
    },
  });
}

export type LineTaskPatch = Partial<
  Pick<PlacementTask, "title" | "department_id" | "hours" | "points" | "points_overridden" | "sort_order">
>;

export function useUpdateLineTask(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: LineTaskPatch }) => {
      const { error } = await sb.from("placement_tasks").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      if (!briefId) return { previous: undefined as PlacementTask[] | undefined };
      await qc.cancelQueries({ queryKey: LINE_TASKS_KEY(briefId) });
      const previous = qc.getQueryData<PlacementTask[]>(LINE_TASKS_KEY(briefId));
      qc.setQueryData<PlacementTask[]>(LINE_TASKS_KEY(briefId), (rows) =>
        (rows ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (briefId && ctx?.previous) qc.setQueryData(LINE_TASKS_KEY(briefId), ctx.previous);
    },
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: LINE_TASKS_KEY(briefId) });
    },
  });
}

export function useDeleteLineTask(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("placement_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      if (!briefId) return { previous: undefined as PlacementTask[] | undefined };
      await qc.cancelQueries({ queryKey: LINE_TASKS_KEY(briefId) });
      const previous = qc.getQueryData<PlacementTask[]>(LINE_TASKS_KEY(briefId));
      qc.setQueryData<PlacementTask[]>(LINE_TASKS_KEY(briefId), (rows) =>
        (rows ?? []).filter((r) => r.id !== id),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (briefId && ctx?.previous) qc.setQueryData(LINE_TASKS_KEY(briefId), ctx.previous);
    },
    onSettled: () => {
      if (briefId) qc.invalidateQueries({ queryKey: LINE_TASKS_KEY(briefId) });
    },
  });
}
