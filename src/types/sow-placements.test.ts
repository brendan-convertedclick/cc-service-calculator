import { describe, expect, it } from "vitest";
import type { BriefTaskSowPlacement } from "./sow-placements";

// Factory mirrors the full row shape — a compile error here flags any drift
// between the hand-maintained type and code building placement rows.
const p = (overrides: Partial<BriefTaskSowPlacement>): BriefTaskSowPlacement => ({
  id: crypto.randomUUID(),
  brief_id: "b",
  task_ref: "t",
  service_area_id: null,
  is_inside: true,
  ai_match_quote: null,
  ai_confidence: null,
  override_reason: null,
  approved_by: null,
  approved_at: null,
  created_at: "",
  updated_at: "",
  item_name: null,
  item_description: null,
  sow_slug: null,
  suggested_service_id: null,
  estimated_cents: null,
  ...overrides,
});

describe("BriefTaskSowPlacement factory", () => {
  it("carries the self-contained item fields added by migration 0061", () => {
    const row = p({
      item_name: "Homepage hero rework",
      item_description: "Replace the hero with the new campaign visual",
      sow_slug: "web-retainer",
      estimated_cents: 250_000,
    });
    expect(row.item_name).toBe("Homepage hero rework");
    expect(row.item_description).toBe("Replace the hero with the new campaign visual");
    expect(row.sow_slug).toBe("web-retainer");
    expect(row.estimated_cents).toBe(250_000);
    expect(row.suggested_service_id).toBeNull();
  });
});
