import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type CreateQuickBriefArgs = {
  brief_id: string;
  task_name: string;
  /** Optional ClickUp task description — omitted → task name + brief body. */
  description?: string;
  assignee_member_id: string | null;
  sprint_points: number;
  work_stream: string;
  due_date: string | null;
  list_id?: string;
  status?: string;
  briefed_by_member_id?: string | null;
  billing_type?: "retainer" | "adhoc";
  /** One item per line — creates a ClickUp checklist on the task. */
  checklist_items?: string[];
  /** Optional files — each uploaded as a ClickUp task attachment after create. */
  attachments?: File[];
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
      const { attachments, ...rest } = args;
      let body: CreateQuickBriefArgs | FormData = rest;
      if (attachments && attachments.length > 0) {
        const form = new FormData();
        form.append("payload", JSON.stringify(rest));
        attachments.forEach((file) => form.append("file", file));
        body = form;
      }
      const { data, error } = await supabase.functions.invoke("create-quick-brief-task", {
        body,
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
