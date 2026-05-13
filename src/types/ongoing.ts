import type { Database } from "./db";

export type TimeCategory = Database["public"]["Tables"]["time_categories"]["Row"];
export type OngoingTask = Database["public"]["Tables"]["ongoing_tasks"]["Row"];
export type OngoingActual = Database["public"]["Tables"]["ongoing_actuals"]["Row"];

export type OngoingTaskWithCategory = OngoingTask & {
  time_category: TimeCategory;
};
