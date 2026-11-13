import type { PostgrestError } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAssignBriefToProject } from "@/hooks/useAssignBriefToProject";
import { groupOutside, type OutsideClient, type OutsideRow } from "@/lib/retainer-outside";

// retainer_outside_work is not in the generated db types yet, so the rpc is untyped here.
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: OutsideRow[] | null; error: PostgrestError | null }>;

export interface RetainerOption { id: string; name: string; clientId: string }

/** Retainer-client time in a SAST "YYYY-MM" month that lands on none of the client's retainers, plus the retainers it could go to. */
export function useRetainerOutside(month: string) {
  return useQuery<{ clients: OutsideClient[]; retainers: RetainerOption[] }>({
    queryKey: ["retainer_outside", month],
    queryFn: async () => {
      const [out, proj] = await Promise.all([
        rpc("retainer_outside_work", { p_month: month }),
        supabase
          .from("projects")
          .select("id, name, client_id")
          .eq("engagement_type", "retainer")
          .eq("status", "in_progress")
          .order("name"),
      ]);
      if (out.error) throw out.error;
      if (proj.error) throw proj.error;
      return {
        clients: groupOutside(out.data ?? []),
        retainers: (proj.data ?? []).map((p) => ({ id: p.id, name: p.name, clientId: p.client_id as string })),
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
