import { describe, expect, it } from "vitest";
import { bucketPlacements, placementCounts, type BriefTaskSowPlacement } from "./sow-placements";

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

describe("bucketPlacements", () => {
  it("groups inside by service_area_id", () => {
    const buckets = bucketPlacements([
      p({ is_inside: true, service_area_id: "A" }),
      p({ is_inside: true, service_area_id: "A" }),
      p({ is_inside: true, service_area_id: "B" }),
    ]);
    expect(buckets.get("A")).toHaveLength(2);
    expect(buckets.get("B")).toHaveLength(1);
  });
  it("collects outside under __outside", () => {
    const buckets = bucketPlacements([
      p({ is_inside: false }),
      p({ is_inside: true, service_area_id: "A" }),
    ]);
    expect(buckets.get("__outside")).toHaveLength(1);
    expect(buckets.get("A")).toHaveLength(1);
  });
});

describe("placementCounts", () => {
  it("counts inside vs outside", () => {
    const r = placementCounts([
      p({ is_inside: true, service_area_id: "A" }),
      p({ is_inside: false }),
      p({ is_inside: false }),
    ]);
    expect(r).toEqual({ inside: 1, outside: 2 });
  });
});
