import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type CreateQuickBriefArgs = {
  brief_id: string;
  task_name: string;
  assignee_member_id: string | null;
  sprint_points: number;
  work_stream: string;
  due_date: string | null;
};

type CreateQuickBriefResult = { clickup_task_id: string; clickup_task_url: string };

export function useCreateQuickBriefTask(): UseMutationResult<
  CreateQuickBriefResult,
  Error,
  CreateQuickBriefArgs
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateQuickBriefArgs): Promise<CreateQuickBriefResult> => {
      const { data, error } = await supabase.functions.invoke("create-quick-brief-task", {
        body: args,
      });
      if (error) throw error;
      const result = data as (CreateQuickBriefResult & { error?: string }) | null;
      if (result?.error) throw new Error(result.error);
      return result as CreateQuickBriefResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["briefs", "inbox"] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
    },
  });
}
