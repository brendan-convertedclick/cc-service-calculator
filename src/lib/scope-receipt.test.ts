import { describe, expect, it } from "vitest";
import {
  buildScopeReceipt,
  confidenceTier,
  lineQty,
  type ReceiptCatalogService,
} from "./scope-receipt";
import type { BriefTaskSowPlacement } from "@/types/sow-placements";

function placement(
  overrides: Partial<BriefTaskSowPlacement> & { task_ref: string },
): BriefTaskSowPlacement {
  return {
    id: overrides.task_ref,
    brief_id: "brief-1",
    service_area_id: null,
    is_inside: false,
    ai_match_quote: null,
    ai_confidence: null,
    override_reason: null,
    approved_by: null,
    approved_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    item_name: overrides.task_ref,
    item_description: null,
    sow_slug: null,
    suggested_service_id: null,
    estimated_cents: null,
    disposition: null,
    quantity: null,
    grounding_quote: null,
    needs_review: null,
    ...overrides,
  };
}

const svc = (over: Partial<ReceiptCatalogService> & { id: string }): ReceiptCatalogService => ({
  code: null,
  name: "Service",
  sell_price_cents: 0,
  unit_of_sale: null,
  ...over,
});

describe("buildScopeReceipt", () => {
  it("always returns the three buckets in fixed order, even when empty", () => {
    const model = buildScopeReceipt([], new Map());
    expect(model.buckets.map((b) => b.disposition)).toEqual([
      "in_agreed_scope",
      "new_billable",
      "out_of_scope",
    ]);
    expect(model.totalLines).toBe(0);
    expect(model.billableTotalCents).toBe(0);
  });

  it("groups placements by disposition and counts per bucket", () => {
    const model = buildScopeReceipt(
      [
        placement({ task_ref: "a", disposition: "in_agreed_scope" }),
        placement({ task_ref: "b", disposition: "new_billable" }),
        placement({ task_ref: "c", disposition: "new_billable" }),
        placement({ task_ref: "d", disposition: "out_of_scope" }),
      ],
      new Map(),
    );
    expect(model.counts).toEqual({
      in_agreed_scope: 1,
      new_billable: 2,
      out_of_scope: 1,
    });
    expect(model.totalLines).toBe(4);
  });

  it("billableTotalCents sums ONLY new_billable lines, qty * unit", () => {
    const services = new Map<string, ReceiptCatalogService>([
      ["s1", svc({ id: "s1", code: "100", sell_price_cents: 50000 })],
    ]);
    const model = buildScopeReceipt(
      [
        // included line with a price must NOT contribute to the billable total
        placement({
          task_ref: "inc",
          disposition: "in_agreed_scope",
          suggested_service_id: "s1",
          quantity: 3,
        }),
        // billable: 2 * 50000 = 100000
        placement({
          task_ref: "bill",
          disposition: "new_billable",
          suggested_service_id: "s1",
          quantity: 2,
        }),
        // out_of_scope with a price must NOT contribute
        placement({
          task_ref: "out",
          disposition: "out_of_scope",
          suggested_service_id: "s1",
          quantity: 5,
        }),
      ],
      services,
    );
    expect(model.billableTotalCents).toBe(100000);
    const billable = model.buckets.find((b) => b.disposition === "new_billable")!;
    expect(billable.subtotalCents).toBe(100000);
    expect(billable.lines[0]).toMatchObject({ code: "100", qty: 2, lineCents: 100000 });
  });

  it("prefers estimated_cents over the catalog sell price for the unit", () => {
    const services = new Map<string, ReceiptCatalogService>([
      ["s1", svc({ id: "s1", sell_price_cents: 50000 })],
    ]);
    const model = buildScopeReceipt(
      [
        placement({
          task_ref: "bill",
          disposition: "new_billable",
          suggested_service_id: "s1",
          estimated_cents: 12345,
          quantity: 2,
        }),
      ],
      services,
    );
    const line = model.buckets.find((b) => b.disposition === "new_billable")!.lines[0];
    expect(line.unitCents).toBe(12345);
    expect(line.lineCents).toBe(24690);
  });

  it("local overrides re-bucket a row and re-total without touching input", () => {
    const placements = [
      placement({
        task_ref: "x",
        disposition: "out_of_scope",
        estimated_cents: 9000,
        quantity: 1,
      }),
    ];
    const base = buildScopeReceipt(placements, new Map());
    expect(base.counts.new_billable).toBe(0);
    expect(base.billableTotalCents).toBe(0);

    const overridden = buildScopeReceipt(placements, new Map(), {
      x: "new_billable",
    });
    expect(overridden.counts.new_billable).toBe(1);
    expect(overridden.counts.out_of_scope).toBe(0);
    expect(overridden.billableTotalCents).toBe(9000);
  });

  it("falls back to is_inside for pre-0071 rows with null disposition", () => {
    const model = buildScopeReceipt(
      [
        placement({ task_ref: "legacy-in", disposition: null, is_inside: true }),
        placement({ task_ref: "legacy-out", disposition: null, is_inside: false }),
      ],
      new Map(),
    );
    expect(model.counts.in_agreed_scope).toBe(1);
    expect(model.counts.new_billable).toBe(1);
    expect(model.counts.out_of_scope).toBe(0);
  });

  it("carries needs_review and grounding_quote through to the line", () => {
    const model = buildScopeReceipt(
      [
        placement({
          task_ref: "r",
          disposition: "new_billable",
          needs_review: true,
          grounding_quote: "build me 3 landing pages",
        }),
      ],
      new Map(),
    );
    const line = model.buckets.find((b) => b.disposition === "new_billable")!.lines[0];
    expect(line.needsReview).toBe(true);
    expect(line.groundingQuote).toBe("build me 3 landing pages");
  });
});

describe("lineQty", () => {
  it("coerces non-positive / non-finite quantities to 1", () => {
    expect(lineQty(placement({ task_ref: "a", quantity: 0 }))).toBe(1);
    expect(lineQty(placement({ task_ref: "b", quantity: -2 }))).toBe(1);
    expect(lineQty(placement({ task_ref: "c", quantity: null }))).toBe(1);
    expect(lineQty(placement({ task_ref: "d", quantity: 4 }))).toBe(4);
  });
});

describe("confidenceTier", () => {
  it("buckets confidence into high/med/low and null", () => {
    expect(confidenceTier(0.95)).toBe("high");
    expect(confidenceTier(0.8)).toBe("high");
    expect(confidenceTier(0.7)).toBe("med");
    expect(confidenceTier(0.6)).toBe("med");
    expect(confidenceTier(0.4)).toBe("low");
    expect(confidenceTier(null)).toBeNull();
  });
});
