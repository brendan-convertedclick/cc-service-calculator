import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  TaskGroup,
  TaskTemplate,
  TimeCategory,
  OngoingTaskWithCategory,
} from "@/types/ongoing";

export function useTaskGroups() {
  return useQuery<TaskGroup[]>({
    queryKey: ["task-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_groups")
        .select("*")
        .is("archived_at", null)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertTaskGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<TaskGroup> & { id?: string; label_key?: string; label?: string },
    ) => {
      if (patch.id) {
        const { error } = await supabase
          .from("task_groups")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", patch.id);
        if (error) throw error;
      } else {
        if (!patch.label_key || !patch.label) {
          throw new Error("label_key and label required when creating a group");
        }
        const { error } = await supabase
          .from("task_groups")
          .insert({ label_key: patch.label_key, label: patch.label, ...patch });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-groups"] }),
  });
}

export function useArchiveTaskGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("task_groups")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-groups"] });
      qc.invalidateQueries({ queryKey: ["time-categories"] });
    },
  });
}

// Returns active templates. Global catalog rows (is_custom=false) plus any
// custom rows scoped to a client. Callers can filter on group_id, is_custom,
// or client_id in-memory.
export function useTimeCategories() {
  return useQuery<TimeCategory[]>({
    queryKey: ["time-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_categories")
        .select("*")
        .is("archived_at", null)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Canonical alias going forward.
export const useTaskTemplates = useTimeCategories;

export function useOngoingTasksForMember(memberId: string | null) {
  return useQuery<OngoingTaskWithCategory[]>({
    queryKey: ["ongoing-tasks", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ongoing_tasks")
        .select("*, time_category:time_categories(*)")
        .eq("team_member_id", memberId!)
        .is("archived_at", null);
      if (error) throw error;
      return (data ?? []) as unknown as OngoingTaskWithCategory[];
    },
  });
}

export function useProvisionOngoingTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamMemberId: string) => {
      const { data, error } = await supabase.functions.invoke(
        "provision-ongoing-tasks",
        { body: { team_member_id: teamMemberId } },
      );
      if (error) throw error;
      if ((data as { error?: string }).error) throw new Error((data as { error: string }).error);
      return data as { provisioned: number; skipped: number };
    },
    onSuccess: (_d, teamMemberId) => {
      qc.invalidateQueries({ queryKey: ["ongoing-tasks", teamMemberId] });
    },
  });
}

export type MatrixFailedCell = {
  member_id: string;
  client_id: string | null;
  task_template_id: string;
  reason: string;
};

export type MatrixResult = {
  provisioned: number;
  skipped: number;
  created: Array<{
    member_id: string;
    client_id: string | null;
    task_template_id: string;
    clickup_task_id: string;
  }>;
  failed: MatrixFailedCell[];
};

export function useProvisionMatrix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      member_ids: string[];
      client_ids: string[];
      task_template_ids: string[];
      group_id?: string | null;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "provision-ongoing-tasks",
        { body: input },
      );
      if (error) throw error;
      const body = data as MatrixResult & { error?: string };
      if (body.error) throw new Error(body.error);
      return body;
    },
    onSuccess: (_d, input) => {
      for (const m of input.member_ids) {
        qc.invalidateQueries({ queryKey: ["ongoing-tasks", m] });
      }
    },
  });
}

export function useUpsertTimeCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<TaskTemplate> & {
        id?: string;
        label_key?: string;
        label?: string;
      },
    ) => {
      if (patch.id) {
        const { error } = await supabase
          .from("time_categories")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", patch.id);
        if (error) throw error;
      } else {
        if (!patch.label_key || !patch.label) {
          throw new Error("label_key and label required when creating a category");
        }
        const { error } = await supabase
          .from("time_categories")
          .insert({ label_key: patch.label_key, label: patch.label, ...patch });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-categories"] }),
  });
}

// Canonical alias.
export const useUpsertTaskTemplate = useUpsertTimeCategory;

export function useArchiveTimeCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("time_categories")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-categories"] }),
  });
}

export const useArchiveTaskTemplate = useArchiveTimeCategory;

// Promote a custom (client-scoped) template into the global catalog so any
// client can pick it on the next planning run. Existing ongoing_tasks rows
// referencing this template keep working — only future provisions are
// affected (per spec section 8.4).
export function usePromoteTaskTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("time_categories")
        .update({ is_custom: false, client_id: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-categories"] }),
  });
}
