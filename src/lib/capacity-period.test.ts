import { describe, expect, it } from "vitest";
import {
  anchorFor,
  isoWeekOf,
  isoWeekStart,
  localMidnightISO,
  periodFor,
  periodInProgress,
  workingDaysBetween,
} from "./capacity-period";

describe("periodFor", () => {
  it("a month runs from its first local day to the first of the next", () => {
    const p = periodFor("month", "2026-09");
    expect([p.startDate, p.endDate]).toEqual(["2026-09-01", "2026-10-01"]);
    expect(p.label).toBe("September 2026");
  });

  it("rolls a December month into the next year", () => {
    expect(periodFor("month", "2026-12").endDate).toBe("2027-01-01");
  });

  it("a week is Monday to Sunday and is NOT clipped to the month", () => {
    // ISO week 40 of 2026 starts Mon 28 Sep and ends Sun 4 Oct.
    const p = periodFor("week", "2026-W40");
    expect([p.startDate, p.endDate]).toEqual(["2026-09-28", "2026-10-05"]);
    expect(p.label).toBe("28 Sep to 4 Oct 2026");
  });

  it("a day is one day", () => {
    const p = periodFor("day", "2026-09-18");
    expect([p.startDate, p.endDate]).toEqual(["2026-09-18", "2026-09-19"]);
  });

  it("bounds are LOCAL midnight, not a UTC date string", () => {
    // The whole point of the file: a bare "2026-09-01" would be 02:00 SAST.
    const p = periodFor("day", "2026-09-18");
    expect(p.startISO).toBe(localMidnightISO("2026-09-18"));
    expect(new Date(p.startISO).getHours()).toBe(0);
    expect(new Date(p.startISO).getDate()).toBe(18);
    // And the range is exactly 24 hours long.
    expect(new Date(p.endISO).getTime() - new Date(p.startISO).getTime()).toBe(86_400_000);
  });
});

describe("iso weeks", () => {
  it("week 1 is the week holding 4 January", () => {
    // 4 Jan 2026 is a Sunday, so ISO week 1 of 2026 starts Mon 29 Dec 2025.
    expect(isoWeekStart("2026-W01")).toBe("2025-12-29");
  });

  it("isoWeekOf and isoWeekStart are inverses across a month boundary", () => {
    for (const d of ["2026-09-28", "2026-09-30", "2026-10-01", "2026-10-04"]) {
      expect(isoWeekStart(isoWeekOf(d))).toBe("2026-09-28");
    }
  });

  it("anchorFor picks the picker value for each granularity", () => {
    expect(anchorFor("month", "2026-09-18")).toBe("2026-09");
    expect(anchorFor("week", "2026-09-18")).toBe("2026-W38");
    expect(anchorFor("day", "2026-09-18")).toBe("2026-09-18");
  });
});

describe("workingDaysBetween", () => {
  it("counts Mon-Fri only", () => {
    // September 2026 starts on a Tuesday and has 22 working days.
    expect(workingDaysBetween("2026-09-01", "2026-10-01")).toBe(22);
    // A full week is always 5.
    expect(workingDaysBetween("2026-09-28", "2026-10-05")).toBe(5);
    // A Saturday on its own is 0 — a day view of a weekend has no capacity.
    expect(workingDaysBetween("2026-09-19", "2026-09-20")).toBe(0);
    expect(workingDaysBetween("2026-09-18", "2026-09-19")).toBe(1);
  });

  it("stops at upTo, inclusive of that day", () => {
    // Fri 18 Sep: 1, 2, 3, 4 then 7..11 then 14..18 = 14 working days.
    expect(workingDaysBetween("2026-09-01", "2026-10-01", new Date(2026, 8, 18))).toBe(14);
    // upTo before the period starts leaves nothing elapsed.
    expect(workingDaysBetween("2026-09-28", "2026-10-05", new Date(2026, 8, 18))).toBe(0);
  });
});

describe("periodInProgress", () => {
  const on = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  it("is true only while today falls inside the period", () => {
    expect(periodInProgress(periodFor("month", "2026-09"), on(2026, 9, 21))).toBe(true);
    expect(periodInProgress(periodFor("month", "2026-08"), on(2026, 9, 21))).toBe(false);
    expect(periodInProgress(periodFor("day", "2026-09-21"), on(2026, 9, 21))).toBe(true);
    expect(periodInProgress(periodFor("day", "2026-09-22"), on(2026, 9, 21))).toBe(false);
  });
});
