// Data + mutations for the system canvas (Phase 6). Top-level step loading
// is reused from `useSystemSteps` (useProcessSteps.ts, Phase 4) rather than
// re-queried here — this file only adds what that hook doesn't cover: edges,
// sub-steps, and position/connect/disconnect mutations.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];
type SystemEdgeRow = Database["public"]["Tables"]["system_edges"]["Row"];

const EDGES_KEY = (systemId: string) => ["system_edges", systemId] as const;

export function useSystemEdges(systemId: string | undefined) {
  return useQuery({
    enabled: !!systemId,
    queryKey: systemId ? EDGES_KEY(systemId) : ["system_edges", "none"],
    queryFn: async (): Promise<SystemEdgeRow[]> => {
      if (!systemId) return [];
      const { data, error } = await supabase.from("system_edges").select("*").eq("system_id", systemId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Sub-steps aren't reliably stamped with `system_id` (only the P4 backfill
// set it; a sub-step created later with just `parent_id` could omit it) —
// query by parent membership instead, which is always correct.
export function useSystemSubSteps(topLevelIds: string[]) {
  return useQuery({
    enabled: topLevelIds.length > 0,
    queryKey: ["process_steps", "substeps", ...[...topLevelIds].sort()],
    queryFn: async (): Promise<Step[]> => {
      const { data, error } = await supabase
        .from("process_steps")
        .select("*")
        .in("parent_id", topLevelIds)
        .order("ordinal");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveStepPosition() {
  return useMutation({
    mutationFn: async ({ id, pos_x, pos_y }: { id: string; pos_x: number; pos_y: number }) => {
      const { error } = await supabase.from("process_steps").update({ pos_x, pos_y }).eq("id", id);
      if (error) throw error;
    },
    // Deliberately no onSuccess/invalidate. SystemCanvas.tsx's local React
    // Flow node state is authoritative for the session (positions are set
    // once on load, then updated locally on drag) — invalidating
    // ["process_steps"] here would refetch mid-drag or mid-debounce and can
    // snap a node back to its pre-save position. A reload reads the saved
    // value from the DB, which is the correctness backstop.
  });
}

export function useConnectSteps(systemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ source, target, sourceHandle }: { source: string; target: string; sourceHandle?: string | null }) => {
      const { error } = await supabase
        .from("system_edges")
        .insert({ system_id: systemId, source_step_id: source, target_step_id: target, source_handle: sourceHandle ?? null });
      // 23505 = unique(source_step_id, target_step_id) violation — the
      // connection already exists. Not an error from the user's point of
      // view; swallow it instead of surfacing a toast for a no-op.
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: EDGES_KEY(systemId) }),
  });
}

// Drag an existing edge's endpoint onto a different handle. React Flow is
// fully controlled here and owns no edge state, so a rejected write needs no
// undo — invalidating on BOTH paths is what snaps the line back to whatever
// the DB still says.
export function useReconnectEdge(systemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      source,
      target,
      sourceHandle,
    }: {
      id: string;
      source: string;
      target: string;
      sourceHandle?: string | null;
    }) => {
      const { error } = await supabase
        .from("system_edges")
        .update({ source_step_id: source, target_step_id: target, source_handle: sourceHandle ?? null })
        .eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: EDGES_KEY(systemId) }),
  });
}

export function useDisconnectSteps(systemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (edgeId: string) => {
      const { error } = await supabase.from("system_edges").delete().eq("id", edgeId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: EDGES_KEY(systemId) }),
  });
}
