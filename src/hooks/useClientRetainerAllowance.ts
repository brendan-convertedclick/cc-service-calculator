// src/hooks/useClientRetainerAllowance.ts
//
// Lightweight retainer-allowance summary for the Scope Receipt meter. Reads the
// client's active retainer project (engagement_type='retainer', in_progress)
// and sums the monthly occurrence allowance across its recurring services. V1
// has no consumption ledger, so this only surfaces the *capacity* — the receipt
// derives "used" / "this quote adds" from the placement buckets.

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const sb = supabase as unknown as SupabaseClient;

export type ClientRetainerAllowance = {
  /** Active retainer project id, or null when the client has none. */
  projectId: string | null;
  /** Total monthly occurrence allowance across the retainer's services. */
  totalOccurrences: number;
  /** Per service_id monthly occurrence allowance. */
  byServiceId: Record<string, number>;
};

const EMPTY: ClientRetainerAllowance = {
  projectId: null,
  totalOccurrences: 0,
  byServiceId: {},
};

export function useClientRetainerAllowance(clientId: string | null | undefined) {
  return useQuery({
    enabled: !!clientId,
    queryKey: ["client-retainer-allowance", clientId],
    staleTime: 60_000,
    queryFn: async (): Promise<ClientRetainerAllowance> => {
      if (!clientId) return EMPTY;
      const { data: project, error: pErr } = await sb
        .from("projects")
        .select("id")
        .eq("client_id", clientId)
        .eq("engagement_type", "retainer")
        // Not a standing monthly task (0154): those keep
        // engagement_type='retainer' for the provisioner, and picking one as
        // "the client's retainer" would measure an allowance against a plugin
        // update.
        .eq("is_recurring_task", false)
        .eq("status", "in_progress")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pErr) throw pErr;
      const projectId = (project as { id: string } | null)?.id ?? null;
      if (!projectId) return EMPTY;

      const { data: rows, error: rErr } = await sb
        .from("retainer_recurring_services")
        .select("service_id, occurrences_per_month")
        .eq("project_id", projectId);
      if (rErr) throw rErr;

      const byServiceId: Record<string, number> = {};
      let total = 0;
      for (const r of (rows ?? []) as Array<{
        service_id: string;
        occurrences_per_month: number;
      }>) {
        const n = Number(r.occurrences_per_month) || 0;
        byServiceId[r.service_id] = (byServiceId[r.service_id] ?? 0) + n;
        total += n;
      }
      return { projectId, totalOccurrences: total, byServiceId };
    },
  });
}
