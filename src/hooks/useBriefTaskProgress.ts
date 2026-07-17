// src/hooks/useBriefTaskProgress.ts
//
// Progress of a brief's handed-off ClickUp work, from the statuses the
// 30-min sync-clickup-actuals cron writes back (placement_tasks.clickup_status
// and briefs.clickup_task_status). A brief's tasks are its Stage-5 scheduled
// placement_tasks when it has any, else its single quick-briefed task.

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// placement_tasks isn't in the generated Database types yet — query untyped
// and cast (same pattern as usePlacementTasks).
const sb = supabase as unknown as SupabaseClient;

const DONE = new Set(["complete", "closed", "done"]);
const IN_PROGRESS = new Set(["in progress", "in review", "review", "qa"]);

export type BriefTaskProgress = {
  done: number;
  total: number;
  /** 0–100; done tasks count 1, in-progress tasks 0.5. */
  pct: number;
};

export function progressFromStatuses(statuses: string[]): BriefTaskProgress | null {
  if (statuses.length === 0) return null;
  let score = 0;
  let done = 0;
  for (const raw of statuses) {
    const s = raw.toLowerCase();
    if (DONE.has(s)) {
      score += 1;
      done++;
    } else if (IN_PROGRESS.has(s)) {
      score += 0.5;
    }
  }
  return {
    done,
    total: statuses.length,
    pct: Math.round((score / statuses.length) * 100),
  };
}

/** Scheduled-task statuses for every brief that has them, keyed by brief id. */
export function useScheduledTaskStatuses() {
  return useQuery({
    queryKey: ["brief-task-statuses"],
    queryFn: async (): Promise<Map<string, string[]>> => {
      const { data, error } = await sb
        .from("placement_tasks")
        .select("brief_id, clickup_status")
        .not("clickup_task_id", "is", null);
      if (error) throw error;
      const byBrief = new Map<string, string[]>();
      for (const row of (data ?? []) as Array<{ brief_id: string; clickup_status: string | null }>) {
        if (!row.clickup_status) continue;
        (byBrief.get(row.brief_id) ?? byBrief.set(row.brief_id, []).get(row.brief_id)!).push(
          row.clickup_status,
        );
      }
      return byBrief;
    },
    staleTime: 60_000,
  });
}
