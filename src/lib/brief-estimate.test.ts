// src/lib/brief-estimate.test.ts
import { describe, it, expect } from "vitest";
import { recomputeTotals, computeEstimatedPriceCents } from "./brief-estimate";
import type { DeptBreakdown } from "@/types/brief-intelligence";

const dept = (o: Partial<DeptBreakdown>): DeptBreakdown => ({
  department_id: "d1",
  department_name: "Dev",
  deliverables: [],
  tasks: [],
  human_hours_low: 0,
  human_hours_mid: 0,
  human_hours_high: 0,
  ai_hours: 0,
  ...o,
});

describe("recomputeTotals", () => {
  it("sums per-department hours", () => {
    const r = recomputeTotals([
      dept({ human_hours_low: 1, human_hours_mid: 2, human_hours_high: 3, ai_hours: 0.5 }),
      dept({ human_hours_low: 2, human_hours_mid: 3, human_hours_high: 4, ai_hours: 1 }),
    ]);
    expect(r).toEqual({
      total_human_hours_low: 3,
      total_human_hours_mid: 5,
      total_human_hours_high: 7,
      total_ai_hours: 1.5,
    });
  });

  it("returns zeros for empty breakdown", () => {
    expect(recomputeTotals([])).toEqual({
      total_human_hours_low: 0,
      total_human_hours_mid: 0,
      total_human_hours_high: 0,
      total_ai_hours: 0,
    });
  });
});

describe("computeEstimatedPriceCents", () => {
  it("multiplies high hours by dept rate and sums", () => {
    const rates = new Map([
      ["d1", 100000],
      ["d2", 50000],
    ]);
    const price = computeEstimatedPriceCents(
      [
        dept({ department_id: "d1", human_hours_high: 4 }),
        dept({ department_id: "d2", human_hours_high: 2.5 }),
      ],
      rates,
    );
    expect(price).toBe(525000);
  });

  it("treats missing rate as zero", () => {
    const price = computeEstimatedPriceCents(
      [dept({ department_id: "x", human_hours_high: 5 })],
      new Map(),
    );
    expect(price).toBe(0);
  });
});
