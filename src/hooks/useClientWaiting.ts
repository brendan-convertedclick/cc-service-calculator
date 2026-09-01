// src/hooks/useClientWaiting.ts
//
// Every brief-created task with a ClickUp id, with both waiting clocks
// attached: how long it has sat in the client's court, and how long in ours.
//
// Open tasks and closed ones come back in the SAME query on purpose. The
// closed ones are the argument: "you were slow" is answered by a year of
// finished work showing where each week actually went, not by the handful of
// things currently stuck. Closing a task freezes its two numbers; nothing is
// deleted and nothing is recomputed.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import { courtOf, waitSplit, type Court, type WaitingSource } from "@/lib/client-waiting";

export type WaitingTask = WaitingSource & {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  clickup_task_url: string | null;
  original_due_date: string | null;
  original_points: number | null;
  created_at: string;
  court: Court;
};

/**
 * Fetched whole rather than paged: ~375 rows today, one row per briefed task
 * ever, and the page's whole job is to sort and total across all of them.
 * Revisit if this passes a few thousand.
 */
export function useClientWaiting() {
  return useQuery({
    queryKey: ["client-waiting"],
    // The clocks move with a 30-minute cron; anything fresher is a lie with
    // extra network. The page extrapolates the running one client-side.
    staleTime: 60_000,
    queryFn: async (): Promise<WaitingTask[]> => {
      const { data, error } = await supabase
        .from("briefs")
        .select(
          "id, client_id, raw_subject, clickup_task_url, clickup_task_status, clickup_status_synced_at, client_wait_ms, internal_wait_ms, completed_at, original_due_date, original_points, created_at, clients!inner(name)",
        )
        .not("clickup_task_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(errorMessage(error));

      return (data ?? []).map((r) => {
        const row = r as typeof r & { clients: { name: string } | null };
        const source: WaitingSource = {
          clickup_task_status: row.clickup_task_status,
          clickup_status_synced_at: row.clickup_status_synced_at,
          client_wait_ms: row.client_wait_ms,
          internal_wait_ms: row.internal_wait_ms,
          completed_at: row.completed_at,
        };
        return {
          ...source,
          id: row.id,
          client_id: row.client_id as string,
          client_name: row.clients?.name ?? "Unknown client",
          title: row.raw_subject ?? "(untitled)",
          clickup_task_url: row.clickup_task_url,
          original_due_date: row.original_due_date,
          original_points: row.original_points as number | null,
          created_at: row.created_at,
          court: courtOf(source),
        };
      });
    },
  });
}

/** Totals for the header line, computed over whatever is currently filtered. */
export function waitingTotals(tasks: WaitingTask[], now: number) {
  let clientMs = 0;
  let internalMs = 0;
  let onClient = 0;
  for (const t of tasks) {
    const split = waitSplit(t, now);
    clientMs += split.clientMs;
    internalMs += split.internalMs;
    if (split.court === "client") onClient += 1;
  }
  return { clientMs, internalMs, onClient };
}
