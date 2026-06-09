import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];

export type RetainerListRow = Pick<
  Project,
  | "id"
  | "name"
  | "status"
  | "retainer_hours_target"
  | "retainer_monthly_fee_cents"
  | "started_at"
> & {
  client_name: string;
};

export function useRetainers() {
  return useQuery({
    queryKey: ["retainers"],
    queryFn: async (): Promise<RetainerListRow[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id, name, status, retainer_hours_target, retainer_monthly_fee_cents, started_at, clients(name)",
        )
        .eq("engagement_type", "retainer")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        retainer_hours_target: p.retainer_hours_target,
        retainer_monthly_fee_cents: p.retainer_monthly_fee_cents,
        started_at: p.started_at,
        client_name: (p.clients as { name: string } | null)?.name ?? "Unknown",
      }));
    },
  });
}

// Deletes a retainer project row. Child rows (recurring services, actuals,
// process-step instances, …) cascade at the DB level; the provisioned ClickUp
// list/tasks are left untouched.
export function useDeleteRetainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["retainers"] });
      qc.invalidateQueries({ queryKey: ["pulseRetainerBurn"] });
    },
  });
}
