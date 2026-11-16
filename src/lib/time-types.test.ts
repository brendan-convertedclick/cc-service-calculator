import { describe, expect, it } from "vitest";
import { averageLabel, averageShare, splitByType, trendMonths, type TypeHoursRow } from "./time-types";

const row = (o: Partial<TypeHoursRow>): TypeHoursRow => ({
  clickup_task_id: "t1", task_name: "x", month: "2026-10", time_type: "delivery", rule: "r", hours: 1, ...o,
});

describe("time types", () => {
  it("splits one month per bar, with unknown tasks off the Book", () => {
    const { all, byCategory } = splitByType(
      [
        row({ hours: "2.5" }),
        row({ clickup_task_id: "t2", time_type: "admin", hours: 1 }),
        row({ clickup_task_id: "t3", time_type: "meetings", hours: 1.5 }),
        row({ clickup_task_id: "t1", month: "2026-09", hours: 9 }),
      ],
      "2026-10",
      (id) => (id === "t1" ? "retainer" : id === "t2" ? "internal" : "offbook"),
    );
    expect(all).toEqual({ meetings: 1.5, admin: 1, delivery: 2.5, unclassified: 0, total: 5 });
    expect(byCategory.retainer.total).toBe(2.5);
    expect(byCategory.internal.admin).toBe(1);
    expect(byCategory.offbook.meetings).toBe(1.5);
  });

  it("averages the full months only, pooled, and never before the cutoff", () => {
    expect(trendMonths("2026-11")).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    const t = (admin: number, total: number) => ({ meetings: 0, admin, delivery: total - admin, unclassified: 0, total });
    const byMonth = new Map([
      ["2026-08", t(1, 100)], // before the cutoff: out
      ["2026-09", t(20, 100)],
      ["2026-10", t(60, 300)],
      ["2026-11", t(50, 50)], // the running month: out
    ]);
    const avg = averageShare(byMonth, "2026-11", "admin")!;
    expect(avg.months).toEqual(["2026-09", "2026-10"]);
    expect(avg.pct).toBeCloseTo(20); // 80 / 400, not the mean of 20% and 20%
    expect(averageLabel(avg.months)).toBe("Sep–Oct average");
    expect(averageShare(new Map(), "2026-11", "admin")).toBeNull();
  });
});
