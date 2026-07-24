import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type BriefedTaskFields = {
  task_name: string;
  sprint_points: number | null;
  due_date: string | null; // "YYYY-MM-DD"
  clickup_task_url: string | null;
  // Completion metrics — present on reads (undefined on write responses).
  status_label?: string | null;
  is_complete?: boolean;
  completed_at?: string | null; // "YYYY-MM-DD"
  estimated_points?: number | null;
  estimated_hours?: number | null;
  actual_points?: number | null;
  actual_hours?: number | null;
  briefed_at?: string | null; // "YYYY-MM-DD" — when briefed into ClickUp
  original_due_date?: string | null; // "YYYY-MM-DD" — original committed due date
  client_wait_ms?: number | null; // time spent waiting on the client (ms)
  client_delay_manual?: boolean; // operator flagged the delay as client-caused
};

async function invokeBriefedTask(body: Record<string, unknown>): Promise<BriefedTaskFields> {
  const { data, error } = await supabase.functions.invoke("update-briefed-task", { body });
  if (error) throw error;
  const result = data as (BriefedTaskFields & { error?: string }) | null;
  if (result?.error) throw new Error(result.error);
  return result as BriefedTaskFields;
}

/** Read the live name / points / due date off the linked ClickUp task. */
export function useBriefedTaskDetails(briefId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["briefed-task", briefId],
    enabled: enabled && !!briefId,
    staleTime: 0,
    queryFn: () => invokeBriefedTask({ brief_id: briefId, mode: "read" }),
  });
}

/** Toggle the manual "this delay was client-caused" flag on a brief. */
export function useFlagClientDelay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { brief_id: string; flagged: boolean }) => {
      // client_delay_manual is newer than the generated db types — query untyped.
      const sb = supabase as unknown as SupabaseClient;
      const { error } = await sb
        .from("briefs")
        .update({ client_delay_manual: args.flagged })
        .eq("id", args.brief_id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["briefed-task", vars.brief_id] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["client-delivery-scorecard"] });
      qc.invalidateQueries({ queryKey: ["delay-trend"] });
    },
  });
}

/** Write edited fields back to the ClickUp task (and mirror the name locally). */
export function useUpdateBriefedTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      brief_id: string;
      task_name?: string;
      sprint_points?: number;
      due_date?: string | null;
      assignee_member_id?: string | null;
    }) => invokeBriefedTask({ ...args, mode: "write" }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["briefed-task", vars.brief_id] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["briefs", "inbox"] });
    },
  });
}
