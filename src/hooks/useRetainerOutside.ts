import type { PostgrestError } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAssignBriefToProject } from "@/hooks/useAssignBriefToProject";
import { callEdgeFn } from "@/lib/edge";
import { adhocName, groupOutside, type DismissKind, type OutsideClient, type OutsideRow } from "@/lib/retainer-outside";

// retainer_outside_work is not in the generated db types yet, so the rpc is untyped here.
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: OutsideRow[] | null; error: PostgrestError | null }>;

export interface RetainerOption { id: string; name: string; clientId: string; open: boolean }

/** Retainer-client time in a SAST "YYYY-MM" month that lands on none of the client's retainers, plus the retainers it could go to. */
export function useRetainerOutside(month: string) {
  return useQuery<{ clients: OutsideClient[]; retainers: RetainerOption[] }>({
    queryKey: ["retainer_outside", month],
    queryFn: async () => {
      const [out, proj] = await Promise.all([
        rpc("retainer_outside_work", { p_month: month }),
        supabase
          .from("projects")
          .select("id, name, client_id, retainer_monthly_fee_cents, retainer_hours_target")
          .eq("engagement_type", "retainer")
          .eq("status", "in_progress")
          .order("name"),
      ]);
      if (out.error) throw out.error;
      if (proj.error) throw proj.error;
      return {
        clients: groupOutside(out.data ?? []),
        // A retainer with no fee and no target (Trellidor Adhoc) has no budget
        // to count against: work booked there is billed for the month, so it
        // leaves the hidden pile as "invoice separately" (0210).
        retainers: (proj.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          clientId: p.client_id as string,
          open: p.retainer_monthly_fee_cents == null && p.retainer_hours_target == null,
        })),
      };
    },
  });
}

/**
 * Book one task's time to a retainer, through whichever record owns the task.
 * A brief goes through set-brief-project, so its ClickUp task moves under the
 * retainer's parent like every other reassignment; one marked Internal is
 * flipped to retainer as well, or the book keeps reading it as ours.
 */
export function useBookOutside() {
  const qc = useQueryClient();
  const assign = useAssignBriefToProject();
  return useMutation({
    mutationFn: async ({ row, projectId }: { row: OutsideRow; projectId: string }) => {
      if (row.brief_id) {
        await assign.mutateAsync({ briefId: row.brief_id, projectId });
        if (row.brief_billing_type === "internal") {
          const { error } = await supabase.from("briefs").update({ billing_type: "retainer" }).eq("id", row.brief_id);
          if (error) throw error;
        }
      } else if (row.meeting_id) {
        const { error } = await supabase.from("internal_meetings").update({ project_id: projectId }).eq("id", row.meeting_id);
        if (error) throw error;
      } else if (row.ongoing_task_id) {
        // ongoing_tasks.project_id (0202) is not in the generated types yet.
        const { error } = await supabase
          .from("ongoing_tasks")
          .update({ project_id: projectId } as never)
          .eq("id", row.ongoing_task_id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retainer_outside"] });
      qc.invalidateQueries({ queryKey: ["retainer_budget"] });
      qc.invalidateQueries({ queryKey: ["retainer_allocation"] });
    },
  });
}

const invalidateOutside = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["retainer_outside"] });
  qc.invalidateQueries({ queryKey: ["retainer_budget"] });
  qc.invalidateQueries({ queryKey: ["retainer_allocation"] });
};

/**
 * Make a leaked brief billable ad hoc, in ClickUp as well as here: invoicing
 * reads the ClickUp task, so the "[Ad Hoc] " prefix goes on its name through
 * update-briefed-task, which writes billing_type in the same call.
 */
export function useConvertOutsideToAdhoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: OutsideRow) => {
      if (!row.brief_id) throw new Error("Only a brief can be converted to ad hoc.");
      await callEdgeFn("update-briefed-task", {
        brief_id: row.brief_id,
        task_name: adhocName(row.task_name ?? ""),
        billing_type: "adhoc",
        parent_project_id: null,
      });
    },
    onSuccess: () => invalidateOutside(qc),
  });
}

// retainer_outside_dismissals (0211) is not in the generated types yet.
type Untyped = {
  from: (t: string) => {
    insert: (v: object) => PromiseLike<{ error: PostgrestError | null }>;
    delete: () => { eq: (col: string, v: string) => PromiseLike<{ error: PostgrestError | null }> };
  };
};
const dismissals = () => (supabase as unknown as Untyped).from("retainer_outside_dismissals");

/** "Confirm internal" or "Mark as sales" (0213). Who and when are stamped by the database. */
export function useDismissOutside() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ row, kind = "internal", undo }: { row: OutsideRow; kind?: DismissKind; undo?: boolean }) => {
      const { error } = undo
        ? await dismissals().delete().eq("clickup_task_id", row.clickup_task_id)
        : await dismissals().insert({ clickup_task_id: row.clickup_task_id, kind });
      if (error) throw error;
    },
    onSuccess: () => invalidateOutside(qc),
  });
}
