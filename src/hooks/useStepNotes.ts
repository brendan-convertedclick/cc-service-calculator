// Notes left on a task or a step of a procedure (0133).
//
// One query per procedure rather than per row: the editor badges every row
// with its note count, so it needs them all anyway, and a key built from step
// ids would churn on every add.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

export type StepNote = Database["public"]["Tables"]["process_step_notes"]["Row"];
type StepNoteUpdate = Database["public"]["Tables"]["process_step_notes"]["Update"];

const NOTES_KEY = (systemId: string) => ["process_step_notes", systemId] as const;
// Every mutation invalidates the whole prefix, not one procedure's key: the
// "assigned to me" set spans the library and hangs off a sibling key, so a
// per-system invalidation would leave the systems list showing a stale count.
const ALL_NOTES_KEY = ["process_step_notes"] as const;

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
    mutationFn: async ({
      stepId,
      body,
      authorId,
      assignedTo,
    }: {
      stepId: string;
      body: string;
      authorId: string | null;
      assignedTo: string | null;
    }) => {
      const { error } = await supabase
        .from("process_step_notes")
        .insert({ system_id: systemId, step_id: stepId, body, created_by: authorId, assigned_to: assignedTo });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_NOTES_KEY }),
  });
}

// Ticking marks the NOTE as dealt with, not the step: a procedure is a
// template, and the work itself is done against the ClickUp task it becomes.
export function useToggleStepNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, done, byId }: { id: string; done: boolean; byId: string | null }) => {
      const { error } = await supabase
        .from("process_step_notes")
        .update({ done_at: done ? new Date().toISOString() : null, done_by: done ? byId : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_NOTES_KEY }),
  });
}

// Editing a note is body + who it's for + which row it hangs on. The author
// and the date stay put — they record who said it and when, not who last
// touched the row.
export function useUpdateStepNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: StepNoteUpdate }) => {
      const { error } = await supabase.from("process_step_notes").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_NOTES_KEY }),
  });
}

export function useDeleteStepNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("process_step_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_NOTES_KEY }),
  });
}

// How many open notes are waiting on me, per system. The library list badges
// each row with its count and filters on the same map, so this counts rather
// than just collecting ids — one row per note across the whole library, and
// only the column needed to bucket them.
export function useMyOpenNoteCounts(memberId: string | null) {
  return useQuery({
    enabled: !!memberId,
    queryKey: ["process_step_notes", "assigned", memberId] as const,
    queryFn: async (): Promise<Map<string, number>> => {
      const counts = new Map<string, number>();
      if (!memberId) return counts;
      const { data, error } = await supabase
        .from("process_step_notes")
        .select("system_id")
        .eq("assigned_to", memberId)
        .is("done_at", null);
      if (error) throw error;
      for (const r of data ?? []) counts.set(r.system_id, (counts.get(r.system_id) ?? 0) + 1);
      return counts;
    },
  });
}
