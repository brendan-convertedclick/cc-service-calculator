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

describe("days off (0172)", () => {
  it("takes a day off out of the person and out of the team", () => {
    // 10 September: 8 working days have passed. One person off 2 of them,
    // and off 5 in the whole month.
    const r = teamCapacity({
      month: SEP, headcount: 4, accountedHours: 0, today: IN_SEP,
      daysOff: { elapsed: 2, total: 5 },
    });
    expect(r.elapsedHours).toBe((8 * 4 - 2) * HOURS_PER_WORKING_DAY);
    expect(r.availableHours).toBe((22 * 4 - 5) * HOURS_PER_WORKING_DAY);
    expect(personCapacityHours(SEP, IN_SEP, 2)).toBe(6 * HOURS_PER_WORKING_DAY);
    // More days off than days does not go negative.
    expect(personCapacityHours(SEP, IN_SEP, 30)).toBe(0);
  });
});

describe("half days (0173)", () => {
  it("a half day is half of 7h", () => {
    expect(personCapacityHours(SEP, IN_SEP, 0.5)).toBe(7.5 * HOURS_PER_WORKING_DAY);
    const r = teamCapacity({
      month: SEP, headcount: 4, accountedHours: 0, today: IN_SEP,
      daysOff: { elapsed: 0.5, total: 1.5 },
    });
    expect(r.elapsedHours).toBe((32 - 0.5) * HOURS_PER_WORKING_DAY);
    expect(r.availableHours).toBe((88 - 1.5) * HOURS_PER_WORKING_DAY);
  });
});
