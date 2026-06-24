import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// retainer_recurring_services isn't in the generated Database types yet
// (Phase 8) — query untyped and shape the row locally, as useRetainerSubItems does.
export type RetainerRecurringServiceRow = {
  id: string;
  project_id: string;
  service_id: string;
  cadence: string;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
  occurrence_labels: string[] | null;
  created_at: string;
};

// One recurring-service row in the edit payload. id present = update an existing
// row; absent = insert a new one. Rows omitted from the array are deleted.
export type RetainerServiceInput = {
  id?: string;
  service_id: string;
  cadence: string;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
  occurrence_labels?: string[];
};

export function useRetainerServices(projectId: string | undefined) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ["retainer-services", projectId],
    queryFn: async (): Promise<RetainerRecurringServiceRow[]> => {
      const sb = supabase as unknown as SupabaseClient;
      const { data, error } = await sb
        .from("retainer_recurring_services")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as RetainerRecurringServiceRow[];
    },
  });
}

export function useUpdateRetainerServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      { projectId, services }: { projectId: string; services: RetainerServiceInput[] },
    ) => {
      const { data, error } = await supabase.functions.invoke("update-retainer-services", {
        body: { project_id: projectId, services },
      });
      if (error) throw error;
      const body = data as { error?: string; updated?: number; inserted?: number; deleted?: number };
      if (body.error) throw new Error(body.error);
      return body;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["retainer-services", vars.projectId] });
    },
  });
}

// Provision the current period now (e.g. after adding a service), then sync so
// the new tasks surface in Conductor immediately rather than on the next cron.
export function useProvisionRetainerNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase.functions.invoke("provision-retainer-period", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const body = data as { error?: string; created?: number; reused?: number };
      if (body.error) throw new Error(body.error);
      // Fire the actuals sync so newly-provisioned tasks appear right away.
      await supabase.functions.invoke("sync-clickup-actuals", { body: { project_id: projectId } });
      return body;
    },
    onSuccess: (_d, projectId) => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
