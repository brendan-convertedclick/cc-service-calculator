// src/hooks/useBriefExtensions.ts
//
// Extension history for a briefed task + the request/approve actions. An
// extension moves the due date and/or adds sprint points, with a reason. A
// billable point extension is held (client_approval_status = pending) until the
// client approves via the request-brief-extension edge function.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// brief_extensions isn't in the generated Database types yet — query untyped.
const sb = supabase as unknown as SupabaseClient;

export type BriefExtension = {
  id: string;
  brief_id: string;
  reason: string;
  prev_due_date: string | null;
  new_due_date: string | null;
  prev_points: number | null;
  new_points: number | null;
  billable: boolean;
  client_approval_status: "none" | "pending" | "approved" | "declined";
  applied: boolean;
  created_at: string;
};

export function useBriefExtensions(briefId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["brief-extensions", briefId],
    enabled: enabled && !!briefId,
    queryFn: async (): Promise<BriefExtension[]> => {
      const { data, error } = await sb
        .from("brief_extensions")
        .select("*")
        .eq("brief_id", briefId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BriefExtension[];
    },
  });
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("request-brief-extension", { body });
  if (error) throw error;
  const result = data as { error?: string } | null;
  if (result?.error) throw new Error(result.error);
  return result;
}

/** Create an extension (due date and/or points, with a reason). */
export function useRequestExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      brief_id: string;
      reason: string;
      new_due_date?: string | null;
      new_sprint_points?: number;
      billable?: boolean;
    }) => invoke(args),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["brief-extensions", vars.brief_id] });
      qc.invalidateQueries({ queryKey: ["briefed-task", vars.brief_id] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
    },
  });
}

/** Approve or decline a pending (billable) point extension. */
export function useResolveExtension(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { extension_id: string; action: "approve" | "decline" }) => invoke(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brief-extensions", briefId] });
      qc.invalidateQueries({ queryKey: ["briefed-task", briefId] });
    },
  });
}
