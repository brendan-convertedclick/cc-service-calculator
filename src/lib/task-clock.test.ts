import { describe, expect, it } from "vitest";
import { calendarMonthNo, clockLabel, taskClock } from "./task-clock";

const months = Array.from({ length: 12 }, (_, i) => ({
  month_no: i + 1,
  starts_on: `2026-${String(i + 1).padStart(2, "0")}-01`,
}));
const TODAY = "2026-09-29";

describe("taskClock", () => {
  it("finds the calendar column from starts_on", () => {
    expect(calendarMonthNo(months, TODAY)).toBe(9);
    expect(calendarMonthNo(months, "2027-01-05")).toBeNull();
  });

  it("counts down to the column's last day in the current month", () => {
    const c = taskClock({ state: "planned", due_date: null, month_no: 9 }, months, TODAY);
    expect(c).toEqual({ kind: "due", days: 1 });
    expect(clockLabel(c!)).toBe("Due in 1d");
  });

  it("rots last month's unfinished work", () => {
    const c = taskClock({ state: "planned", due_date: null, month_no: 8 }, months, TODAY);
    expect(c).toEqual({ kind: "rot", days: 29 });
    expect(clockLabel(c!)).toBe("29d rotting");
  });

  it("leaves older undated plans alone", () => {
    expect(taskClock({ state: "planned", due_date: null, month_no: 7 }, months, TODAY)).toBeNull();
    expect(taskClock({ state: "planned", due_date: null, month_no: 10 }, months, TODAY)).toBeNull();
  });

  it("always clocks a real due date, whatever the column", () => {
    expect(taskClock({ state: "scheduled", due_date: "2026-09-02", month_no: 1 }, months, TODAY)).toEqual({ kind: "rot", days: 27 });
  });

  it("stops the clock on done work", () => {
    expect(taskClock({ state: "done", due_date: "2026-09-02", month_no: 9 }, months, TODAY)).toBeNull();
  });
});
