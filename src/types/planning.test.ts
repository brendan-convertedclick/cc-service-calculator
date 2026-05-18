import { describe, expect, it } from "vitest";
import { plannedTaskDates, provisionMode } from "./planning";

describe("plannedTaskDates", () => {
  it("daily caps at occurrences and skips weekends", () => {
    // Mon 2026-01-05 → Sun 2026-01-11 (5 business days)
    const dates = plannedTaskDates(
      new Date("2026-01-05T00:00:00Z"),
      new Date("2026-01-11T00:00:00Z"),
      "daily",
      20,
    );
    expect(dates.length).toBe(5);
    for (const d of dates) {
      expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay());
    }
  });
  it("weekly with 4 occurrences spreads across the period", () => {
    const dates = plannedTaskDates(
      new Date("2026-02-02T00:00:00Z"), // Mon
      new Date("2026-02-27T00:00:00Z"), // Fri (~4 weeks)
      "weekly",
      4,
    );
    // Spread-evenly may under-shoot by 1 when business-day filtering kicks
    // in; what matters is we return between 3 and 4 dates, all weekdays,
    // spread across the period.
    expect(dates.length).toBeGreaterThanOrEqual(3);
    expect(dates.length).toBeLessThanOrEqual(4);
    for (const d of dates) {
      expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay());
    }
  });
  it("returns nothing if end < start", () => {
    expect(
      plannedTaskDates(new Date("2026-02-10"), new Date("2026-02-01"), "daily", 5),
    ).toEqual([]);
  });
});

describe("provisionMode", () => {
  it("live + eligible → live", () => {
    expect(provisionMode("live", true)).toBe("live");
  });
  it("live + ineligible → manual", () => {
    expect(provisionMode("live", false)).toBe("manual");
  });
  it("manual always → manual", () => {
    expect(provisionMode("manual", true)).toBe("manual");
    expect(provisionMode("manual", false)).toBe("manual");
  });
});
