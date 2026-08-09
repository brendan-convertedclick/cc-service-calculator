import { describe, it, expect } from "vitest";
import { toISODate, todayISO } from "./dates";

describe("toISODate", () => {
  it("uses local calendar fields, not UTC", () => {
    // 01:00 local. In any timezone ahead of UTC (SAST is UTC+2) the UTC date is
    // still the previous day, which is exactly the bug this helper replaces.
    const earlyMorning = new Date(2026, 7, 9, 1, 0, 0);
    expect(toISODate(earlyMorning)).toBe("2026-08-09");
  });

  it("zero-pads month and day", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("todayISO matches toISODate(now)", () => {
    expect(todayISO()).toBe(toISODate(new Date()));
  });
});
