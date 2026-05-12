import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { computeBubbleRadii, computeMultiplierFrontend } from "./useOutputMultiplier";

describe("computeMultiplierFrontend", () => {
  it("returns (human + ai) / human", () => {
    expect(computeMultiplierFrontend(2, 18)).toBe(10);
  });
  it("caps at 20", () => {
    expect(computeMultiplierFrontend(0.1, 100)).toBe(20);
  });
  it("returns 1 when human is 0", () => {
    expect(computeMultiplierFrontend(0, 5)).toBe(1);
  });
});

describe("computeBubbleRadii", () => {
  it("inner radius grows with human hours", () => {
    const small = computeBubbleRadii(1, 5, 2);
    const large = computeBubbleRadii(9, 5, 2);
    expect(large.innerR).toBeGreaterThan(small.innerR);
  });

  it("middle radius is always larger than inner", () => {
    const r = computeBubbleRadii(2, 18, 8);
    expect(r.middleR).toBeGreaterThan(r.innerR);
  });

  it("outer radius is capped at 90 when middleR is well below the cap", () => {
    // innerR ≈ 22.53, rawMiddleR ≈ 82.53, rawOuterR = 90 → outerR = max(90, 84.53) = 90
    const r = computeBubbleRadii(0.1, 100, 20);
    expect(r.outerR).toBeLessThanOrEqual(92);
  });

  it("outer radius always encloses middleR by at least 2 when multiplier is 1", () => {
    // aiHours=0 → middleR = innerR; outerR = max(innerR*1, innerR+2) = innerR+2
    const r = computeBubbleRadii(5, 0, 1);
    expect(r.outerR).toBeGreaterThanOrEqual(r.middleR + 2);
  });
});
