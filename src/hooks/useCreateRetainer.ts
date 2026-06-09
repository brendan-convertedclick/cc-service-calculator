import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import type { Cadence } from "@/types/planning";

// One recurring service in the create-retainer request body. Mirrors a
// retainer_recurring_services row minus the DB-managed columns (id,
// project_id, created_at) — the edge function fills those in.
export type CreateRetainerServiceInput = {
  service_id: string;
  cadence: Cadence;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
};

// Request body for the create-retainer edge function.
export type CreateRetainerInput = {
  client_id: string;
  clickup_list_id: string;
  name: string;
  retainer_hours_target: number;
  retainer_monthly_fee_cents: number;
  recurrence_start: string;
  services: CreateRetainerServiceInput[];
};

export type CreateRetainerResult = {
  project_id: string;
  provision_warning?: string;
};

export function useCreateRetainer() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (input: CreateRetainerInput): Promise<CreateRetainerResult> => {
      const { data, error } = await supabase.functions.invoke("create-retainer", {
        body: input,
      });
      if (error) throw error;
      const body = data as {
        error?: string;
        project_id?: string;
        provision_warning?: string;
      };
      if (body.error) throw new Error(body.error);
      return { project_id: body.project_id!, provision_warning: body.provision_warning };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["retainers"] });
      qc.invalidateQueries({ queryKey: ["pulseRetainerBurn"] });
      navigate(`/projects/${result.project_id}`);
    },
  });
}
