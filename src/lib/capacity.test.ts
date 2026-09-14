import { describe, expect, it } from "vitest";
import { teamCapacity, personCapacityHours, HOURS_PER_WORKING_DAY } from "./capacity";

// August 2026 has 21 working days — the month Lisa quoted her 588 from
// (4 people × 7h × 21). September has 22, which is why this uses real working
// days rather than a flat 21.
const AUG = "2026-08";
const SEP = "2026-09";
const IN_SEP = new Date(2026, 8, 10); // 10 September, a Thursday

describe("teamCapacity", () => {
  it("reproduces the 588 hours Lisa quoted for a 21-day month", () => {
    const r = teamCapacity({ month: AUG, headcount: 4, accountedHours: 0, today: IN_SEP });
    expect(r.availableHours).toBe(588);
  });

  it("judges a finished month whole", () => {
    // August's real figure: 201.3 accounted of 588.
    const r = teamCapacity({ month: AUG, headcount: 4, accountedHours: 201.3, today: IN_SEP });
    expect(r.inProgress).toBe(false);
    expect(Math.round(r.pctOfMonth)).toBe(34);
    // A finished month has fully elapsed, so the two readings agree.
    expect(r.pctOfElapsed).toBeCloseTo(r.pctOfMonth);
  });

  it("judges a running month against the part that has happened", () => {
    // Without this, every month reads as a catastrophe on the 2nd — the same
    // trap retainer-status.ts documents for the retainer badge.
    const r = teamCapacity({ month: SEP, headcount: 4, accountedHours: 69.3, today: IN_SEP });
    expect(r.inProgress).toBe(true);
    expect(r.elapsedHours).toBeLessThan(r.availableHours);
    expect(r.pctOfElapsed).toBeGreaterThan(r.pctOfMonth);
  });

  it("does not divide by zero when nobody is on the team", () => {
    const r = teamCapacity({ month: AUG, headcount: 0, accountedHours: 10, today: IN_SEP });
    expect(r.pctOfMonth).toBe(0);
    expect(r.pctOfElapsed).toBe(0);
  });
});

describe("personCapacityHours", () => {
  it("is one person's share of a finished month", () => {
    expect(personCapacityHours(AUG, IN_SEP)).toBe(21 * HOURS_PER_WORKING_DAY);
  });

  it("is pro-rated inside the running month", () => {
    expect(personCapacityHours(SEP, IN_SEP)).toBeLessThan(22 * HOURS_PER_WORKING_DAY);
  });
});
