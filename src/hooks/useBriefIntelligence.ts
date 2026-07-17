// src/hooks/useBriefIntelligence.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type BriefIntelligence =
  Database["public"]["Tables"]["brief_intelligence"]["Row"];
type BriefIntelligenceUpdate =
  Database["public"]["Tables"]["brief_intelligence"]["Update"];

const KEY = (briefId: string | undefined) =>
  ["brief-intelligence", briefId] as const;

export function useBriefIntelligence(
  briefId: string | undefined,
  opts?: { paused?: boolean },
) {
  const paused = opts?.paused ?? false;
  return useQuery({
    queryKey: KEY(briefId),
    queryFn: async (): Promise<BriefIntelligence | null> => {
      if (!briefId) return null;
      const { data, error } = await supabase
        .from("brief_intelligence")
        .select("*")
        .eq("brief_id", briefId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!briefId,
    // Poll every 5s while pending so the UI updates when intake finishes —
    // paused while the AM is editing so a refetch can't clobber the draft.
    refetchInterval: (query) =>
      !paused && query.state.data?.am_status === "pending" ? 5000 : false,
  });
}

/**
 * Create a blank intelligence row for a brief that has none (manual briefs —
 * intake only generates intelligence for email-sourced ones). Seeds the
 * summary so the operator edits from the brief text instead of a blank page.
 */
export function useCreateBriefIntelligence(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ summary }: { summary: string | null }) => {
      const { data, error } = await supabase
        .from("brief_intelligence")
        .insert({ brief_id: briefId, summary })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(briefId) });
    },
  });
}

export function useApproveBriefIntelligence(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("brief_intelligence")
        .update({
          am_status: "approved",
          am_reviewed_at: new Date().toISOString(),
        })
        .eq("brief_id", briefId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(briefId) });
    },
  });
}

export function useUpdateBriefIntelligence(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: BriefIntelligenceUpdate) => {
      const { data, error } = await supabase
        .from("brief_intelligence")
        .update(patch)
        .eq("brief_id", briefId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(briefId) });
    },
  });
}

export function useRejectBriefIntelligence(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ notes }: { notes: string }) => {
      const { data, error } = await supabase
        .from("brief_intelligence")
        .update({
          am_status: "rejected",
          am_notes: notes,
          am_reviewed_at: new Date().toISOString(),
        })
        .eq("brief_id", briefId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(briefId) });
    },
  });
}
