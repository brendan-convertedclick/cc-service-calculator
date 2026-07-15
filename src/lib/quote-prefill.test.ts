import { describe, expect, it } from "vitest";
import { placementsToQuoteSeed, type SeedCatalogEntry } from "./quote-prefill";
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

const catalog = (entries: SeedCatalogEntry[]) =>
  new Map(entries.map((e) => [e.id, e]));

describe("placementsToQuoteSeed", () => {
  it("seeds one line per billable placement's service, qty from the placement", () => {
    const { lines, skipped } = placementsToQuoteSeed(
      [
        placement({
          task_ref: "a",
          disposition: "new_billable",
          suggested_service_id: "svc-1",
          quantity: 6.5,
          estimated_cents: 600000,
        }),
      ],
      catalog([{ id: "svc-1", sell_price_cents: 600000 }]),
    );
    expect(skipped).toEqual([]);
    expect(lines).toEqual([
      { service_id: "svc-1", qty: 6.5, unit_price_override_cents: null },
    ]);
  });

  it("carries an operator-edited unit price as an override when it differs from catalogue", () => {
    const { lines } = placementsToQuoteSeed(
      [
        placement({
          task_ref: "a",
          disposition: "new_billable",
          suggested_service_id: "svc-1",
          quantity: 1,
          estimated_cents: 550000,
        }),
      ],
      catalog([{ id: "svc-1", sell_price_cents: 600000 }]),
    );
    expect(lines).toEqual([
      { service_id: "svc-1", qty: 1, unit_price_override_cents: 550000 },
    ]);
  });

  it("merges placements sharing a service: quantities sum, money is preserved", () => {
    const { lines } = placementsToQuoteSeed(
      [
        placement({
          task_ref: "a",
          disposition: "new_billable",
          suggested_service_id: "svc-1",
          quantity: 1,
          estimated_cents: 100000,
        }),
        placement({
          task_ref: "b",
          disposition: "new_billable",
          suggested_service_id: "svc-1",
          quantity: 3,
          estimated_cents: 200000,
        }),
      ],
      catalog([{ id: "svc-1", sell_price_cents: 200000 }]),
    );
    // total = 1×1000 + 3×2000 = R7000 over qty 4 → unit R1750 (≠ catalogue R2000)
    expect(lines).toEqual([
      { service_id: "svc-1", qty: 4, unit_price_override_cents: 175000 },
    ]);
  });

  it("ignores included and out-of-scope placements", () => {
    const { lines, skipped } = placementsToQuoteSeed(
      [
        placement({
          task_ref: "in",
          disposition: "in_agreed_scope",
          suggested_service_id: "svc-1",
        }),
        placement({ task_ref: "out", disposition: "out_of_scope" }),
      ],
      catalog([{ id: "svc-1", sell_price_cents: 100000 }]),
    );
    expect(lines).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("reports billable lines with no linked (or unknown) service as skipped", () => {
    const { lines, skipped } = placementsToQuoteSeed(
      [
        placement({
          task_ref: "unlinked",
          item_name: "Mystery ask",
          disposition: "new_billable",
        }),
        placement({
          task_ref: "ghost",
          item_name: "Ghost service",
          disposition: "new_billable",
          suggested_service_id: "not-in-catalogue",
        }),
      ],
      catalog([]),
    );
    expect(lines).toEqual([]);
    expect(skipped).toEqual(["Mystery ask", "Ghost service"]);
  });

  it("treats legacy outside rows (null disposition, is_inside=false) as billable", () => {
    const { lines } = placementsToQuoteSeed(
      [
        placement({
          task_ref: "legacy",
          disposition: null,
          is_inside: false,
          suggested_service_id: "svc-1",
          estimated_cents: null,
        }),
      ],
      catalog([{ id: "svc-1", sell_price_cents: 42000 }]),
    );
    // No placement estimate → falls back to catalogue price → no override.
    expect(lines).toEqual([
      { service_id: "svc-1", qty: 1, unit_price_override_cents: null },
    ]);
  });

  it("clamps degenerate quantities up to the 0.25 editor minimum", () => {
    const { lines } = placementsToQuoteSeed(
      [
        placement({
          task_ref: "tiny",
          disposition: "new_billable",
          suggested_service_id: "svc-1",
          quantity: 0.1,
          estimated_cents: 100000,
        }),
      ],
      catalog([{ id: "svc-1", sell_price_cents: 100000 }]),
    );
    expect(lines[0].qty).toBe(0.25);
  });
});
