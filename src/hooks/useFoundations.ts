import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  ApplyFoundationsResult,
  BaselineList,
  BaselineTask,
} from "@/types/foundations";

type BaselineListWithGroup = BaselineList & {
  task_groups: { id: string; label: string; label_key: string } | null;
};

export function useBaselineLists() {
  return useQuery<BaselineListWithGroup[]>({
    queryKey: ["baseline-lists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("baseline_lists")
        .select("*, task_groups(id, label, label_key)")
        .is("archived_at", null)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as BaselineListWithGroup[];
    },
  });
}

export function useBaselineTasks(baselineListId: string | null) {
  return useQuery<BaselineTask[]>({
    queryKey: ["baseline-tasks", baselineListId],
    enabled: !!baselineListId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("baseline_tasks")
        .select("*")
        .eq("baseline_list_id", baselineListId!)
        .is("archived_at", null)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateBaselineList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      group_id: string;
      label: string;
      description?: string | null;
      display_order?: number;
    }) => {
      const { data, error } = await supabase
        .from("baseline_lists")
        .insert({
          group_id: input.group_id,
          label: input.label,
          description: input.description ?? null,
          display_order: input.display_order ?? 0,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["baseline-lists"] });
      qc.invalidateQueries({ queryKey: ["foundations-coverage"] });
    },
  });
}

export function useArchiveBaselineList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("baseline_lists")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["baseline-lists"] });
      qc.invalidateQueries({ queryKey: ["foundations-coverage"] });
    },
  });
}

export function useCreateBaselineTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      baseline_list_id: string;
      name: string;
      description?: string | null;
      display_order?: number;
    }) => {
      const { data, error } = await supabase
        .from("baseline_tasks")
        .insert({
          baseline_list_id: input.baseline_list_id,
          name: input.name,
          description: input.description ?? null,
          display_order: input.display_order ?? 0,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["baseline-tasks", input.baseline_list_id] });
      qc.invalidateQueries({ queryKey: ["baseline-lists"] });
      qc.invalidateQueries({ queryKey: ["foundations-coverage"] });
    },
  });
}

export function useUpdateBaselineTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      baseline_list_id: string;
      name?: string;
      description?: string | null;
      display_order?: number;
    }) => {
      const { id, baseline_list_id: _bl, ...patch } = input;
      const { error } = await supabase
        .from("baseline_tasks")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["baseline-tasks", input.baseline_list_id] });
    },
  });
}

export function useArchiveBaselineTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; baseline_list_id: string }) => {
      const { error } = await supabase
        .from("baseline_tasks")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["baseline-tasks", input.baseline_list_id] });
      qc.invalidateQueries({ queryKey: ["baseline-lists"] });
      qc.invalidateQueries({ queryKey: ["foundations-coverage"] });
    },
  });
}

export function useApplyFoundations() {
  const qc = useQueryClient();
  return useMutation<
    ApplyFoundationsResult,
    Error,
    {
      client_ids: string[];
      baseline_list_ids?: string[] | null;
      include_tasks?: boolean;
    }
  >({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke(
        "apply-foundations",
        { body: input },
      );
      if (error) throw error;
      const body = data as ApplyFoundationsResult & { error?: string };
      if (body.error) throw new Error(body.error);
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["foundations-coverage"] });
      qc.invalidateQueries({ queryKey: ["client-lists"] });
    },
  });
}
