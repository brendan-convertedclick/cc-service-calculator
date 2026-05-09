// src/hooks/useBriefIntelligence.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type BriefIntelligence =
  Database["public"]["Tables"]["brief_intelligence"]["Row"];

const KEY = (briefId: string | undefined) =>
  ["brief-intelligence", briefId] as const;

export function useBriefIntelligence(briefId: string | undefined) {
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
    // Poll every 5s while pending so the UI updates when intake finishes
    refetchInterval: (query) =>
      query.state.data?.am_status === "pending" ? 5000 : false,
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
