import { describe, expect, it } from "vitest";
import {
  currentMonthNo,
  hoursByMonth,
  lateCounts,
  monthProgress,
  moveLegality,
  type MonthLike,
  type TaskLike,
} from "@/lib/pipeline-move";

const months = (closedThrough: number): MonthLike[] =>
  Array.from({ length: 12 }, (_, i) => ({
    month_no: i + 1,
    closed_at: i + 1 <= closedThrough ? "2027-01-31T00:00:00Z" : null,
  }));

describe("currentMonthNo", () => {
  it("is the lowest month with no closed_at", () => {
    expect(currentMonthNo(months(2))).toBe(3);
  });

  it("is null once every month is closed", () => {
    expect(currentMonthNo(months(12))).toBeNull();
  });
});

describe("moveLegality", () => {
  const task = (over: Partial<TaskLike> = {}): TaskLike => ({ id: "t1", month_no: 3, state: "planned", ...over });

  it("refuses to move a done task at all", () => {
    const verdict = moveLegality(task({ state: "done" }), 5, months(2));
    expect(verdict).toEqual({ ok: false, reason: "Completed work does not move." });
  });

  it("refuses to move out of a closed month", () => {
    const verdict = moveLegality(task({ month_no: 1 }), 5, months(2));
    expect(verdict.ok).toBe(false);
  });

  it("refuses to move into a closed month", () => {
    const verdict = moveLegality(task({ month_no: 5 }), 2, months(2));
    expect(verdict.ok).toBe(false);
  });

  it("moving into the current month schedules it", () => {
    const verdict = moveLegality(task({ month_no: 5 }), 3, months(2));
    expect(verdict).toEqual({ ok: true, nextState: "scheduled" });
  });

  it("moving into a future month leaves it planned", () => {
    const verdict = moveLegality(task({ month_no: 3 }), 7, months(2));
    expect(verdict).toEqual({ ok: true, nextState: "planned" });
  });
});

describe("hoursByMonth", () => {
  it("sums per month, treats null as zero, and keeps every month present", () => {
    const totals = hoursByMonth([
      { month_no: 3, est_hours: 2 },
      { month_no: 3, est_hours: null },
      { month_no: 3, est_hours: 1.5 },
    ]);
    expect(totals.size).toBe(12);
    expect(totals.get(3)).toBe(3.5);
    expect(totals.get(7)).toBe(0); // a month with no tasks at all
  });
});

describe("monthProgress", () => {
  it("counts done against total for one month", () => {
    const tasks: TaskLike[] = [
      { id: "a", month_no: 3, state: "done" },
      { id: "b", month_no: 3, state: "scheduled" },
      { id: "c", month_no: 4, state: "done" },
    ];
    expect(monthProgress(tasks, 3)).toEqual({ done: 1, total: 2 });
  });

  it("a month with no tasks is 0 of 0", () => {
    expect(monthProgress([], 5)).toEqual({ done: 0, total: 0 });
  });
});

describe("lateCounts", () => {
  it("splits overdue work by side and ignores planned and done", () => {
    const counts = lateCounts(
      [
        { side: "us", state: "scheduled", due_date: "2027-01-01" },
        { side: "school", state: "scheduled", due_date: "2027-01-05" },
        { side: "school", state: "scheduled", due_date: "2027-01-05" },
        { side: "us", state: "planned", due_date: null }, // no date, never late
        { side: "school", state: "done", due_date: "2027-01-01" }, // done, never late
        { side: "us", state: "scheduled", due_date: "2027-06-01" }, // in the future
      ],
      "2027-02-01",
    );
    expect(counts).toEqual({ ours: 1, theirs: 2 });
  });
});
