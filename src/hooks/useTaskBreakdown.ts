// src/hooks/useTaskBreakdown.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type TaskBreakdownView = "year" | "month" | "week" | "day";

export interface TaskHours {
  bucket: string;
  userId: number;
  taskId: string;
  taskName: string;
  hours: number;
}

export interface TaskBreakdownData {
  entries: TaskHours[];
  tasks: { id: string; name: string }[];
  meta: {
    periodLabel: string;
    totalHours: number;
    taskCount: number;
  };
}

export function useTaskBreakdown(
  view: TaskBreakdownView,
  date: string,
  clickupUserId?: number,
) {
  return useQuery<TaskBreakdownData>({
    queryKey: ["task-breakdown", view, date, clickupUserId ?? "team"],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-task-breakdown", {
        body: { view, date, clickup_user_id: clickupUserId },
      });
      if (error) throw error;
      return data as TaskBreakdownData;
    },
  });
}
