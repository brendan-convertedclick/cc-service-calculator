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
  /** This retainer alone is our cost (projects.is_internal, 0162). */
  | "is_internal"
> & {
  client_name: string;
  /** Our own work rather than a paying client's (clients.is_internal, 0152). */
  client_is_internal: boolean;
};

/** Whether work can meaningfully be briefed AGAINST this retainer — i.e. whether
 *  `useRetainerAllocation`'s bucketOf will route the brief to it rather than
 *  dropping it in "Retainer work, no retainer".
 *
 *  Two shapes fail, and both are traps rather than choices in a picker:
 *  a retainer with neither a fee nor an hours target (the open arrangement —
 *  Trellidor's, which is itself named "Adhoc Retainer" and is therefore the
 *  most obvious thing to pick for ad hoc work), and a standing monthly task
 *  (0154), which answers "is this getting done" rather than holding a budget. */
export function isBillableRetainer(r: {
  is_recurring_task: boolean;
  retainer_monthly_fee_cents: number | null;
  retainer_hours_target: number | null;
}): boolean {
  if (r.is_recurring_task) return false;
  return r.retainer_monthly_fee_cents != null || r.retainer_hours_target != null;
}

/** Whether a retainer belongs in the Internal book. The client flag (0152) and
 *  the retainer's own (0162) are OR-ed: a brand of ours is our own work
 *  whatever the retainer says, so the switch can move work OUT of the client
 *  book and never into it. */
export function isInternalRetainer(r: {
  is_internal: boolean | null;
  client_is_internal: boolean;
}): boolean {
  return r.client_is_internal || r.is_internal === true;
}

export function useRetainers() {
  return useQuery({
    queryKey: ["retainers"],
    queryFn: async (): Promise<RetainerListRow[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id, name, status, client_id, retainer_hours_target, retainer_monthly_fee_cents, started_at, revenue_source, is_recurring_task, is_internal, clients(name, is_internal)",
        )
        .eq("engagement_type", "retainer")
        // An archived retainer is not part of the book. Nothing was archived
        // until now, so this changed no number when it was added — it is what
        // makes archiving a usable way to retire a line, since
        // useRetainerAllocation already excludes archived and the row would
        // otherwise sit here for ever with every figure showing a dash.
        .neq("status", "archived")
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
        is_internal: p.is_internal,
        client_name: (p.clients as { name: string } | null)?.name ?? "Unknown",
        client_is_internal: (p.clients as { is_internal: boolean } | null)?.is_internal ?? false,
      }));
    },
  });
}

// The per-retainer Internal switch (0162). Flipping it moves the row between
// the Client Retainers / Recurring tabs and the Internal one, which is the
// whole point — the two are different books and a month is judged on the
// client half. Invalidates the allocation query too: every total on the page
// is recomputed from which side a row sits on.
export function useSetRetainerInternal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isInternal }: { id: string; isInternal: boolean }): Promise<void> => {
      const { error } = await supabase
        .from("projects")
        .update({ is_internal: isInternal })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retainers"] });
      qc.invalidateQueries({ queryKey: ["retainer_allocation"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
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
