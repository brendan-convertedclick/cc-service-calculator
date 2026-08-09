// Procedures attached to the blocks of a process canvas (0114).
//
// A block on a kind='process' system describes a stage of the flow; 0..N
// procedures hang off it. Zero is the useful state — an outcome with no
// procedure behind it is a gap the canvas is meant to make visible.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type SystemKind = Database["public"]["Enums"]["system_kind"];

export type AttachedProcedure = {
  id: string; // process_step_procedures.id — the row to delete
  step_id: string;
  system_id: string;
  name: string;
  kind: SystemKind;
};

export const STEP_PROCEDURES_KEY = ["process_step_procedures"] as const;

/** Every attachment on this system's blocks, grouped by step id. */
export function useStepProcedures(systemId: string | undefined) {
  return useQuery({
    enabled: !!systemId,
    queryKey: [...STEP_PROCEDURES_KEY, systemId ?? "none"],
    queryFn: async (): Promise<Map<string, AttachedProcedure[]>> => {
      if (!systemId) return new Map();
      // !inner on the step embed turns it into a join filter, so this is one
      // round trip rather than "fetch step ids, then fetch attachments".
      const { data, error } = await supabase
        .from("process_step_procedures")
        .select("id, step_id, system_id, ordinal, procedure:system_definitions(name, kind), step:process_steps!inner(system_id)")
        .eq("step.system_id", systemId)
        .order("ordinal");
      if (error) throw error;

      type Row = {
        id: string;
        step_id: string;
        system_id: string;
        procedure: { name: string; kind: SystemKind } | null;
      };
      const byStep = new Map<string, AttachedProcedure[]>();
      for (const r of (data ?? []) as unknown as Row[]) {
        const list = byStep.get(r.step_id) ?? [];
        list.push({
          id: r.id,
          step_id: r.step_id,
          system_id: r.system_id,
          name: r.procedure?.name ?? "(deleted)",
          kind: r.procedure?.kind ?? "reference",
        });
        byStep.set(r.step_id, list);
      }
      return byStep;
    },
  });
}

export function useAttachProcedure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, systemId }: { stepId: string; systemId: string }) => {
      const { error } = await supabase
        .from("process_step_procedures")
        .insert({ step_id: stepId, system_id: systemId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: STEP_PROCEDURES_KEY }),
  });
}

export function useDetachProcedure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("process_step_procedures").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: STEP_PROCEDURES_KEY }),
  });
}
