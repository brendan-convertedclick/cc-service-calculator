import { describe, expect, it } from "vitest";
import { detectBudgetProblems, detectExtensionPressure } from "./project-problems";

describe("detectBudgetProblems", () => {
  it("no flags when under budget", () => {
    expect(detectBudgetProblems({ actualPoints: 10, budgetedPoints: 20, timelineProgress: 0.5 }))
      .toEqual([]);
  });
  it("budget_overrun med for small overrun", () => {
    const r = detectBudgetProblems({ actualPoints: 22, budgetedPoints: 20, timelineProgress: 0.5 });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("budget_overrun");
    expect(r[0].severity).toBe("med");
  });
  it("budget_overrun high for >25%", () => {
    const r = detectBudgetProblems({ actualPoints: 30, budgetedPoints: 20, timelineProgress: 0.5 });
    expect(r[0].severity).toBe("high");
  });
  it("underquoting at 85% timeline with >25% overrun", () => {
    const r = detectBudgetProblems({ actualPoints: 30, budgetedPoints: 20, timelineProgress: 0.85 });
    const types = r.map((x) => x.type);
    expect(types).toContain("budget_overrun");
    expect(types).toContain("underquoting");
  });
  it("no underquoting before 80% timeline", () => {
    const r = detectBudgetProblems({ actualPoints: 30, budgetedPoints: 20, timelineProgress: 0.7 });
    expect(r.map((x) => x.type)).not.toContain("underquoting");
  });
  it("zero budget short-circuits", () => {
    expect(detectBudgetProblems({ actualPoints: 5, budgetedPoints: 0, timelineProgress: 0.9 }))
      .toEqual([]);
  });
});

describe("detectExtensionPressure", () => {
  it("null when under 2 extensions", () => {
    expect(detectExtensionPressure(0)).toBeNull();
    expect(detectExtensionPressure(1)).toBeNull();
  });
  it("low severity at 2-3", () => {
    expect(detectExtensionPressure(2)?.severity).toBe("low");
    expect(detectExtensionPressure(3)?.severity).toBe("low");
  });
  it("med severity at 4+", () => {
    expect(detectExtensionPressure(4)?.severity).toBe("med");
    expect(detectExtensionPressure(10)?.severity).toBe("med");
  });
});
