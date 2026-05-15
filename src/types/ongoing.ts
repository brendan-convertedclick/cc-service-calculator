import type { Database } from "./db";

export type TaskGroup = Database["public"]["Tables"]["task_groups"]["Row"];

// time_categories is the templates catalog. TaskTemplate is the canonical
// alias going forward; TimeCategory stays for backward compatibility with
// existing consumers (Team.tsx, useOngoingTasks).
export type TaskTemplate = Database["public"]["Tables"]["time_categories"]["Row"];
export type TimeCategory = TaskTemplate;

export type ClientList = Database["public"]["Tables"]["client_lists"]["Row"];

export type OngoingTask = Database["public"]["Tables"]["ongoing_tasks"]["Row"];
export type OngoingActual = Database["public"]["Tables"]["ongoing_actuals"]["Row"];

export type OngoingTaskWithCategory = OngoingTask & {
  time_category: TimeCategory;
};

export type TaskTemplateWithGroup = TaskTemplate & {
  group: TaskGroup | null;
};
