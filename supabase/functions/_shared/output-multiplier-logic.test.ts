import { describe, it, expect } from "vitest";
import { periodRange, computeMultiplier } from "./output-multiplier-logic.ts";

describe("periodRange", () => {
  it("returns correct month range", () => {
    const r = periodRange("month", "2026-05-12");
    expect(r.startDate).toBe("2026-05-01");
    expect(r.endDate).toBe("2026-06-01");
    expect(r.label).toBe("May 2026");
  });

  it("returns correct week range — Mon to Sun", () => {
    // 2026-05-12 is a Tuesday
    const r = periodRange("week", "2026-05-12");
    expect(r.startDate).toBe("2026-05-11"); // Monday
    expect(r.endDate).toBe("2026-05-18");   // following Monday (exclusive)
    expect(r.label).toMatch(/W\d+ 2026/);
  });

  it("returns correct year range", () => {
    const r = periodRange("year", "2026-05-12");
    expect(r.startDate).toBe("2026-01-01");
    expect(r.endDate).toBe("2027-01-01");
    expect(r.label).toBe("2026");
  });
});

describe("computeMultiplier", () => {
  it("returns (human + ai) / human", () => {
    expect(computeMultiplier(2, 18)).toBe(10);
  });

  it("caps at 20", () => {
    expect(computeMultiplier(0.1, 100)).toBe(20);
  });

  it("returns 1 when human hours is 0", () => {
    expect(computeMultiplier(0, 10)).toBe(1);
  });

  it("returns 1 when no AI hours", () => {
    expect(computeMultiplier(5, 0)).toBe(1);
  });
});
