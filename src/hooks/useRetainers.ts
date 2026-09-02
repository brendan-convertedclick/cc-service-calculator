import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];

export type RetainerListRow = Pick<
  Project,
  | "id"
  | "name"
  | "status"
  | "client_id"
  | "retainer_hours_target"
  | "retainer_monthly_fee_cents"
  | "started_at"
  | "revenue_source"
  | "is_recurring_task"
> & {
  client_name: string;
  /** Our own work rather than a paying client's (clients.is_internal, 0152). */
  client_is_internal: boolean;
};

export function useRetainers() {
  return useQuery({
    queryKey: ["retainers"],
    queryFn: async (): Promise<RetainerListRow[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id, name, status, client_id, retainer_hours_target, retainer_monthly_fee_cents, started_at, revenue_source, is_recurring_task, clients(name, is_internal)",
        )
        .eq("engagement_type", "retainer")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        client_id: p.client_id,
        retainer_hours_target: p.retainer_hours_target,
        retainer_monthly_fee_cents: p.retainer_monthly_fee_cents,
        started_at: p.started_at,
        revenue_source: p.revenue_source,
        is_recurring_task: p.is_recurring_task,
        client_name: (p.clients as { name: string } | null)?.name ?? "Unknown",
        client_is_internal: (p.clients as { is_internal: boolean } | null)?.is_internal ?? false,
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
