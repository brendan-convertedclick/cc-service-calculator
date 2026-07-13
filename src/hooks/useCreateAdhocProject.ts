import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type AdhocTaskInput = {
  task_name: string;
  assignee_member_id: string | null;
  sprint_points: number;
  work_stream: string;
  status?: string;
  due_date: string | null;
};

export type CreateAdhocProjectArgs = {
  client_id: string;
  project_name: string;
  tasks: AdhocTaskInput[];
};

export type CreateAdhocProjectResult = {
  project_id: string;
  clickup_list_id: string;
  clickup_parent_task_id: string;
  created_task_ids: string[];
  task_failures?: Array<{ task_name: string; error: string }>;
};

export function useCreateAdhocProject(): UseMutationResult<
  CreateAdhocProjectResult,
  Error,
  CreateAdhocProjectArgs
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateAdhocProjectArgs): Promise<CreateAdhocProjectResult> => {
      const { data, error } = await supabase.functions.invoke("create-adhoc-project", {
        body: args,
      });
      if (error) throw error;
      const result = data as (CreateAdhocProjectResult & { error?: string }) | null;
      if (result?.error) throw new Error(result.error);
      return result as CreateAdhocProjectResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
