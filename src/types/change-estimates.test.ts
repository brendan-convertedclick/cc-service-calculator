import { describe, expect, it } from "vitest";
import { rollupCE, type ChangeEstimateLineItem } from "./change-estimates";

const li = (
  overrides: Partial<ChangeEstimateLineItem>,
): ChangeEstimateLineItem => ({
  id: "x",
  change_estimate_id: "ce",
  service_id: null,
  description: "",
  qty: 1,
  unit_points: 0,
  unit_value_cents: 0,
  line_kind: "add",
  target_task_id: null,
  sort_order: 0,
  ...overrides,
});

describe("rollupCE", () => {
  it("sums adds", () => {
    const r = rollupCE([
      li({ qty: 2, unit_points: 4, unit_value_cents: 100_00, line_kind: "add" }),
      li({ qty: 1, unit_points: 2, unit_value_cents: 50_00, line_kind: "add" }),
    ]);
    expect(r.delta_points).toBe(10);
    expect(r.delta_value_cents).toBe(250_00);
  });
  it("subtracts cancel/reduce", () => {
    const r = rollupCE([
      li({ qty: 1, unit_points: 4, unit_value_cents: 100_00, line_kind: "add" }),
      li({ qty: 1, unit_points: 4, unit_value_cents: 100_00, line_kind: "cancel" }),
    ]);
    expect(r.delta_points).toBe(0);
    expect(r.delta_value_cents).toBe(0);
  });
  it("mixed adds + reductions", () => {
    const r = rollupCE([
      li({ qty: 2, unit_points: 4, unit_value_cents: 100_00, line_kind: "add" }), // +8pt +R200
      li({ qty: 1, unit_points: 1, unit_value_cents: 50_00, line_kind: "reduce" }), // -1pt -R50
    ]);
    expect(r.delta_points).toBe(7);
    expect(r.delta_value_cents).toBe(150_00);
  });
});
