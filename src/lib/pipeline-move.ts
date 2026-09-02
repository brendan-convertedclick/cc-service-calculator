// src/lib/pipeline-move.ts
//
// Pure: whether a drag/click-move is legal, and the per-month rollups the
// board and planner render. This is UI affordance only — tg_school_tasks_guard
// in 0150_school_pipeline.sql is the actual gate, enforced for both input
// paths (drag and click-to-move) and for any other writer. Mirror its rules
// here so a move is refused on screen before the round trip, not after.

import { todayISO } from "@/lib/dates";

export interface MonthLike {
  month_no: number;
  closed_at: string | null;
}

export interface TaskLike {
  id: string;
  month_no: number;
  state: "planned" | "scheduled" | "done";
}

export type MoveVerdict =
  | { ok: true; nextState: "planned" | "scheduled" }
  | { ok: false; reason: string }; // the exact line the live region reads

/** min(month_no) where closed_at is null; null once every month is closed. */
export function currentMonthNo(months: MonthLike[]): number | null {
  const open = months.filter((m) => m.closed_at === null).map((m) => m.month_no);
  return open.length ? Math.min(...open) : null;
}

/** Mirrors tg_school_tasks_guard's order: done, then out-of-closed, then into-closed. */
export function moveLegality(task: TaskLike, to: number, months: MonthLike[]): MoveVerdict {
  if (task.state === "done") {
    return { ok: false, reason: "Completed work does not move." };
  }

  const from = months.find((m) => m.month_no === task.month_no);
  if (from?.closed_at) {
    return { ok: false, reason: `Month ${from.month_no} is closed — work cannot be moved out of it.` };
  }

  const target = months.find((m) => m.month_no === to);
  if (target?.closed_at) {
    return { ok: false, reason: `Month ${to} is closed — work cannot be scheduled into it.` };
  }

  const current = currentMonthNo(months);
  return { ok: true, nextState: to === current ? "scheduled" : "planned" };
}

/** Per-month est_hours totals. Nulls count as zero; every month 1–12 has an entry. */
export function hoursByMonth(tasks: { month_no: number; est_hours: number | null }[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (let n = 1; n <= 12; n += 1) totals.set(n, 0);
  for (const t of tasks) {
    totals.set(t.month_no, (totals.get(t.month_no) ?? 0) + (t.est_hours ?? 0));
  }
  return totals;
}

/** done / total for one month's tasks. */
export function monthProgress(tasks: TaskLike[], monthNo: number): { done: number; total: number } {
  const inMonth = tasks.filter((t) => t.month_no === monthNo);
  return { done: inMonth.filter((t) => t.state === "done").length, total: inMonth.length };
}

/** Late split by side, for the card's two chips. Planned (no date) and done are never late. */
export function lateCounts(
  tasks: { side: "us" | "school"; state: string; due_date: string | null }[],
  today: string = todayISO(),
): { ours: number; theirs: number } {
  const late = tasks.filter(
    (t) => t.state !== "planned" && t.state !== "done" && t.due_date !== null && t.due_date < today,
  );
  return {
    ours: late.filter((t) => t.side === "us").length,
    theirs: late.filter((t) => t.side === "school").length,
  };
}
