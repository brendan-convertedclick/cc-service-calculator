// src/hooks/useClientDeliveryScorecard.ts
//
// Per-client delivery health for a billing cycle, computed from the briefs
// table (one briefed task = one deliverable in Conductor). Answers "did we
// cover what was briefed, and how well" at the grain the agency actually
// briefs at — not a per-line-item checklist (see the scope-coverage decision).
//
//   • delivered this cycle  — briefs with completed_at inside [start, end)
//   • on time / late        — of those delivered, split by closed_late
//   • over budget           — of those delivered, over the original points
//   • avg turnaround        — created → completed, in days (our-clock proxy
//                             until the two-clock client-delay model lands)
//   • still open            — currently briefed-but-not-completed tasks, with
//                             overdue ones flagged against original_due_date
//
// Completion flags (closed_late / over_budget / completed_at) are maintained
// by the sync-clickup-actuals cron against each brief's frozen baseline.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** A single still-open briefed task, for the open-backlog list. */
export interface OpenTask {
  id: string;
  name: string;
  clickup_task_url: string | null;
  original_due_date: string | null; // "YYYY-MM-DD"
  status_label: string | null; // live ClickUp status, if synced
  overdue: boolean; // original_due_date is in the past
}

export interface DeliveryScorecard {
  delivered: number;
  onTime: number;
  late: number;
  overBudget: number;
  onTimeRate: number | null; // onTime / delivered, null when nothing delivered
  avgTurnaroundDays: number | null; // created → completed (total), null when no data
  avgOurTimeDays: number | null; // turnaround minus client-wait = our working clock
  avgClientWaitDays: number | null; // time sat in "send to client" = their clock
  clientCausedLate: number; // late deliveries whose overrun is covered by client-wait
  openCount: number;
  overdueOpenCount: number;
  openTasks: OpenTask[];
}

type BriefRow = {
  id: string;
  raw_subject: string | null;
  clickup_task_url: string | null;
  completed_at: string | null;
  closed_late: boolean | null;
  over_budget: boolean | null;
  original_due_date: string | null;
  created_at: string | null;
  clickup_task_status: string | null;
  client_wait_ms: number | null;
  client_delay_manual: boolean | null;
};

/** Whole calendar days a completion is past a due date (>= 0). */
function calendarDaysLate(due: string | null, completedIso: string | null): number {
  if (!due || !completedIso) return 0;
  const dueMs = Date.parse(`${due}T00:00:00Z`);
  const doneMs = Date.parse(`${completedIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dueMs) || Number.isNaN(doneMs)) return 0;
  return Math.max(0, Math.round((doneMs - dueMs) / MS_PER_DAY));
}

const MS_PER_DAY = 86_400_000;

/** Whole-day count between two ISO timestamps (>= 0), or null if either missing. */
function daysBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / MS_PER_DAY);
}

export function useClientDeliveryScorecard(
  clientId: string,
  cycleStartIso: string,
  cycleEndIso: string,
) {
  return useQuery<DeliveryScorecard>({
    queryKey: ["client-delivery-scorecard", clientId, cycleStartIso, cycleEndIso],
    enabled: !!clientId,
    queryFn: async () => {
      // All briefed tasks for the client — completed ones keep status='briefed'
      // with completed_at set, open ones have completed_at null.
      const { data, error } = await supabase
        .from("briefs")
        .select(
          "id, raw_subject, clickup_task_url, completed_at, closed_late, over_budget, original_due_date, created_at, clickup_task_status, client_wait_ms, client_delay_manual",
        )
        .eq("client_id", clientId)
        .eq("status", "briefed");
      if (error) throw error;
      const rows = (data ?? []) as unknown as BriefRow[];

      const startMs = new Date(cycleStartIso).getTime();
      const endMs = new Date(cycleEndIso).getTime();
      const todayStr = new Date().toISOString().slice(0, 10);

      let delivered = 0;
      let onTime = 0;
      let late = 0;
      let overBudget = 0;
      let clientCausedLate = 0;
      let turnaroundSum = 0;
      let turnaroundCount = 0;
      let clientWaitSum = 0;
      let ourTimeSum = 0;
      const openTasks: OpenTask[] = [];

      for (const b of rows) {
        if (b.completed_at) {
          const doneMs = new Date(b.completed_at).getTime();
          // Delivered *this cycle* = completed within [start, end).
          if (doneMs >= startMs && doneMs < endMs) {
            delivered++;
            if (b.closed_late) late++;
            else onTime++;
            if (b.over_budget) overBudget++;
            const clientWaitDays = b.client_wait_ms != null ? b.client_wait_ms / MS_PER_DAY : 0;
            const turn = daysBetween(b.created_at, b.completed_at);
            if (turn != null) {
              turnaroundSum += turn;
              turnaroundCount++;
              clientWaitSum += clientWaitDays;
              ourTimeSum += Math.max(0, turn - clientWaitDays);
            }
            // A late delivery is "client-caused" when the days it ran over are
            // covered by time the task sat waiting on the client.
            if (b.closed_late) {
              const daysLate = calendarDaysLate(b.original_due_date, b.completed_at);
              if (daysLate > 0 && (clientWaitDays >= daysLate || b.client_delay_manual)) clientCausedLate++;
            }
          }
        } else {
          // Still open — a point-in-time backlog, not cycle-bound.
          openTasks.push({
            id: b.id,
            name: b.raw_subject ?? "Untitled task",
            clickup_task_url: b.clickup_task_url,
            original_due_date: b.original_due_date,
            status_label: b.clickup_task_status,
            overdue: b.original_due_date != null && b.original_due_date < todayStr,
          });
        }
      }

      // Overdue first, then soonest due date, then undated.
      openTasks.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        const ad = a.original_due_date ?? "9999-12-31";
        const bd = b.original_due_date ?? "9999-12-31";
        return ad.localeCompare(bd);
      });

      return {
        delivered,
        onTime,
        late,
        overBudget,
        onTimeRate: delivered > 0 ? onTime / delivered : null,
        avgTurnaroundDays:
          turnaroundCount > 0 ? Math.round((turnaroundSum / turnaroundCount) * 10) / 10 : null,
        avgOurTimeDays:
          turnaroundCount > 0 ? Math.round((ourTimeSum / turnaroundCount) * 10) / 10 : null,
        avgClientWaitDays:
          turnaroundCount > 0 ? Math.round((clientWaitSum / turnaroundCount) * 10) / 10 : null,
        clientCausedLate,
        openCount: openTasks.length,
        overdueOpenCount: openTasks.filter((t) => t.overdue).length,
        openTasks,
      };
    },
  });
}
