// src/hooks/useDelayTrend.ts
//
// "Delays: client vs internal" report. For a client + period, attributes every
// late delivery to a cause — internal (our clock ran over) or client (the task
// sat waiting on the client long enough to cover the overrun) — and trends it by
// the month the work was delivered. Built from the briefs table + client_wait_ms
// (filled by the sync cron from time in "waiting on client" / "send to client").

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const MS_PER_DAY = 86_400_000;

export interface DelayMonth {
  month: string; // "YYYY-MM"
  label: string; // "Jul 2026"
  delivered: number;
  onTime: number;
  internalLate: number;
  clientLate: number;
  avgClientWaitDays: number | null;
}

export interface DelayLateTask {
  id: string;
  name: string;
  url: string | null;
  cause: "client" | "internal";
  daysLate: number;
  clientWaitDays: number;
  completed: string; // "YYYY-MM-DD"
}

export interface DelayTrend {
  months: DelayMonth[];
  delivered: number;
  onTime: number;
  internalLate: number;
  clientLate: number;
  avgClientWaitDays: number | null;
  avgOurTimeDays: number | null;
  lateTasks: DelayLateTask[];
}

type Row = {
  id: string;
  raw_subject: string | null;
  clickup_task_url: string | null;
  completed_at: string | null;
  closed_late: boolean | null;
  original_due_date: string | null;
  created_at: string | null;
  client_wait_ms: number | null;
  client_delay_manual: boolean | null;
};

function calendarDaysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const am = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const bm = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(am) || Number.isNaN(bm)) return 0;
  return Math.max(0, Math.round((bm - am) / MS_PER_DAY));
}

const MONTH_FMT = new Intl.DateTimeFormat("en-ZA", { month: "short", year: "numeric" });

export function useDelayTrend(clientId: string, startIso: string, endIso: string) {
  return useQuery<DelayTrend>({
    queryKey: ["delay-trend", clientId, startIso, endIso],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefs")
        .select(
          "id, raw_subject, clickup_task_url, completed_at, closed_late, original_due_date, created_at, client_wait_ms, client_delay_manual",
        )
        .eq("client_id", clientId)
        .eq("status", "briefed")
        .not("completed_at", "is", null);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Row[];

      const startMs = new Date(startIso).getTime();
      const endMs = new Date(endIso).getTime();

      const monthMap = new Map<
        string,
        { delivered: number; onTime: number; internalLate: number; clientLate: number; waitSum: number }
      >();
      let delivered = 0;
      let onTime = 0;
      let internalLate = 0;
      let clientLate = 0;
      let waitSum = 0;
      let ourTimeSum = 0;
      let turnCount = 0;
      const lateTasks: DelayLateTask[] = [];

      for (const b of rows) {
        if (!b.completed_at) continue;
        const doneMs = new Date(b.completed_at).getTime();
        if (doneMs < startMs || doneMs >= endMs) continue;

        delivered++;
        const clientWaitDays = b.client_wait_ms != null ? b.client_wait_ms / MS_PER_DAY : 0;
        waitSum += clientWaitDays;
        const turn = calendarDaysBetween(b.created_at, b.completed_at);
        ourTimeSum += Math.max(0, turn - clientWaitDays);
        turnCount++;

        const monthKey = b.completed_at.slice(0, 7); // "YYYY-MM"
        const m = monthMap.get(monthKey) ??
          { delivered: 0, onTime: 0, internalLate: 0, clientLate: 0, waitSum: 0 };
        m.delivered++;
        m.waitSum += clientWaitDays;

        const daysLate = b.closed_late
          ? calendarDaysBetween(b.original_due_date, b.completed_at)
          : 0;
        const isLate = !!b.closed_late && daysLate > 0;
        const clientCaused = isLate && (clientWaitDays >= daysLate || !!b.client_delay_manual);

        if (!isLate) {
          onTime++;
          m.onTime++;
        } else if (clientCaused) {
          clientLate++;
          m.clientLate++;
          lateTasks.push({
            id: b.id,
            name: b.raw_subject ?? "Untitled task",
            url: b.clickup_task_url,
            cause: "client",
            daysLate,
            clientWaitDays: Math.round(clientWaitDays * 10) / 10,
            completed: b.completed_at.slice(0, 10),
          });
        } else {
          internalLate++;
          m.internalLate++;
          lateTasks.push({
            id: b.id,
            name: b.raw_subject ?? "Untitled task",
            url: b.clickup_task_url,
            cause: "internal",
            daysLate,
            clientWaitDays: Math.round(clientWaitDays * 10) / 10,
            completed: b.completed_at.slice(0, 10),
          });
        }
        monthMap.set(monthKey, m);
      }

      const months: DelayMonth[] = [...monthMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, m]) => ({
          month,
          label: MONTH_FMT.format(new Date(`${month}-01T00:00:00`)),
          delivered: m.delivered,
          onTime: m.onTime,
          internalLate: m.internalLate,
          clientLate: m.clientLate,
          avgClientWaitDays: m.delivered > 0 ? Math.round((m.waitSum / m.delivered) * 10) / 10 : null,
        }));

      // Worst offenders first.
      lateTasks.sort((a, b) => b.daysLate - a.daysLate);

      return {
        months,
        delivered,
        onTime,
        internalLate,
        clientLate,
        avgClientWaitDays: turnCount > 0 ? Math.round((waitSum / turnCount) * 10) / 10 : null,
        avgOurTimeDays: turnCount > 0 ? Math.round((ourTimeSum / turnCount) * 10) / 10 : null,
        lateTasks,
      };
    },
  });
}
