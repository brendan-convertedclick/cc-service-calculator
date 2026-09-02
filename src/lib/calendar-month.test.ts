import { describe, expect, it } from "vitest";
import {
  monthGrid,
  monthLabel,
  monthsWithEntries,
  shiftMonth,
  type CalendarEntry,
} from "@/lib/calendar-month";

const entry = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: "e1",
  date: "2026-09-14",
  label: "Trade show",
  kind: "event",
  ...over,
});

describe("monthGrid", () => {
  it("starts on a Monday and fills whole weeks", () => {
    const weeks = monthGrid("2026-09", []);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 1 Sep 2026 is a Tuesday, so the grid opens on Mon 31 Aug.
    expect(weeks[0][0].date).toBe("2026-08-31");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][1].date).toBe("2026-09-01");
    expect(weeks[0][1].inMonth).toBe(true);
  });

  it("pads to whole weeks without adding an empty trailing row", () => {
    // Feb 2027 starts on a Monday and has 28 days: exactly four rows, no padding.
    const weeks = monthGrid("2027-02", []);
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0].date).toBe("2027-02-01");
    expect(weeks[3][6].date).toBe("2027-02-28");
  });

  it("puts entries on their own day and nowhere else", () => {
    const weeks = monthGrid("2026-09", [entry(), entry({ id: "e2", date: "2026-09-14" })]);
    const days = weeks.flat();
    expect(days.find((d) => d.date === "2026-09-14")?.entries).toHaveLength(2);
    expect(days.filter((d) => d.entries.length > 0)).toHaveLength(1);
  });

  it("drops an entry outside the visible range rather than clamping it", () => {
    const days = monthGrid("2026-09", [entry({ date: "2027-01-02" })]).flat();
    expect(days.some((d) => d.entries.length > 0)).toBe(false);
  });

  it("marks today, and only today", () => {
    const days = monthGrid("2026-09", [], "2026-09-14").flat();
    expect(days.filter((d) => d.isToday).map((d) => d.date)).toEqual(["2026-09-14"]);
  });
});

describe("shiftMonth", () => {
  it("crosses the year boundary both ways", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("does not overflow off the end of a short month", () => {
    // Naive date maths from the 31st lands in March. The grid is built from
    // the 1st precisely so it cannot.
    expect(shiftMonth("2026-01", 1)).toBe("2026-02");
  });
});

describe("monthLabel", () => {
  it("names the month, not the padding", () => {
    expect(monthLabel("2026-09")).toMatch(/September 2026/);
  });
});

describe("monthsWithEntries", () => {
  it("always offers the starting month, even with nothing on it", () => {
    expect(monthsWithEntries([], "2026-09")).toEqual(["2026-09"]);
  });

  it("collects the months that have something, oldest first", () => {
    const months = monthsWithEntries(
      [entry({ date: "2026-11-02" }), entry({ id: "e2", date: "2026-08-30" })],
      "2026-09",
    );
    expect(months).toEqual(["2026-08", "2026-09", "2026-11"]);
  });
});
