// Is everything in ClickUp actually in Conductor?
//
// Lisa, 2026-09-02, asking for a confidence value and something to check
// Conductor against. The whole reconciliation lives in the `clickup-reconcile`
// edge function — it needs the ClickUp PAT, which never reaches the browser.
//
// Not on a schedule and deliberately not auto-run: it pages the whole Clients
// space, so it is a button you press, not a widget that fires on every render.
import { useMutation } from "@tanstack/react-query";
import { callEdgeFn } from "@/lib/edge";

export interface MissingTask {
  task_id: string;
  name: string;
  list: string;
  client: string | null;
  points: number | null;
}

export interface DataHealth {
  window: { since: string; pages: number; truncated: boolean };
  clickup: {
    closed_tasks: number;
    client_tasks: number;
    client_matched: number;
    internal_unmatched: number;
  };
  /** Percent of CLIENT work in ClickUp that Conductor can see. */
  confidence: number;
  missing: MissingTask[];
  missing_points: number;
  missing_hours: number;
  unmapped_lists: Array<{ list_id: string; name: string }>;
  conductor: {
    last_sync: string | null;
    stale_briefs: number;
    archived_briefs: number;
    briefed_without_task: Array<{
      id: string;
      subject: string | null;
      created_at: string;
      client: string | null;
    }>;
  };
}

export function useDataHealth() {
  return useMutation({
    mutationFn: (since: string) => callEdgeFn<DataHealth>("clickup-reconcile", { since }),
  });
}

/** Green above 98, amber above 90, red below — a month with 10% of its client
 *  work missing is not "nearly right", it is a month you cannot report on. */
export function confidenceTone(pct: number): string {
  if (pct >= 98) return "text-m-tertiary";
  if (pct >= 90) return "text-amber-600";
  return "text-m-error";
}
