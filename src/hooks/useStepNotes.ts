// Notes left on a task or a step of a procedure (0133).
//
// One query per procedure rather than per row: the editor badges every row
// with its note count, so it needs them all anyway, and a key built from step
// ids would churn on every add.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

export type StepNote = Database["public"]["Tables"]["process_step_notes"]["Row"];

const NOTES_KEY = (systemId: string) => ["process_step_notes", systemId] as const;

export function useStepNotes(systemId: string | undefined) {
  return useQuery({
    enabled: !!systemId,
    queryKey: systemId ? NOTES_KEY(systemId) : ["process_step_notes", "none"],
    queryFn: async (): Promise<StepNote[]> => {
      if (!systemId) return [];
      const { data, error } = await supabase
        .from("process_step_notes")
        .select("*")
        .eq("system_id", systemId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAddStepNote(systemId: string) {
  const qc = useQueryClient();
  return useMutation({
    // authorId is the caller's team_members id, which is null for the shared
    // team@ login (see CLAUDE.md) — the column allows it and the panel reads
    // the note back as unattributed rather than refusing to write it.
    mutationFn: async ({ stepId, body, authorId }: { stepId: string; body: string; authorId: string | null }) => {
      const { error } = await supabase
        .from("process_step_notes")
        .insert({ system_id: systemId, step_id: stepId, body, created_by: authorId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTES_KEY(systemId) }),
  });
}

// Ticking marks the NOTE as dealt with, not the step: a procedure is a
// template, and the work itself is done against the ClickUp task it becomes.
export function useToggleStepNote(systemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, done, byId }: { id: string; done: boolean; byId: string | null }) => {
      const { error } = await supabase
        .from("process_step_notes")
        .update({ done_at: done ? new Date().toISOString() : null, done_by: done ? byId : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTES_KEY(systemId) }),
  });
}

export function useDeleteStepNote(systemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("process_step_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTES_KEY(systemId) }),
  });
}
