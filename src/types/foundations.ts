import type { Database } from "@/types/db";

export type BaselineList = Database["public"]["Tables"]["baseline_lists"]["Row"];
export type BaselineTask = Database["public"]["Tables"]["baseline_tasks"]["Row"];
export type ClientBaselineTaskLog =
  Database["public"]["Tables"]["client_baseline_tasks_log"]["Row"];

export type FoundationsCoverageRow =
  Database["public"]["Views"]["v_foundations_coverage"]["Row"];

export type ApplyFoundationsResult = {
  applied: Array<{
    client_id: string;
    lists_created: number;
    lists_existing: number;
    tasks_created: number;
    tasks_existing: number;
  }>;
  skipped: Array<{ client_id: string; reason: string }>;
  errors: Array<{
    client_id: string;
    baseline_list_id?: string;
    baseline_task_id?: string;
    reason: string;
  }>;
};
