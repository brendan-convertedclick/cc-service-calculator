import { describe, expect, it } from "vitest";
import {
  isBillablePlacement,
  makeManualTaskRef,
  placementDisposition,
  type BriefTaskSowPlacement,
} from "./sow-placements";

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
  // Scope Ledger Rail (migration 0071).
  disposition: null,
  quantity: null,
  grounding_quote: null,
  needs_review: null,
  client_reason: null,
  is_assumed: null,
  excluded: null,
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

  it("carries the Scope Ledger Rail fields added by migration 0071", () => {
    const row = p({
      disposition: "new_billable",
      quantity: 3,
      grounding_quote: "please build three landing pages",
      needs_review: true,
    });
    expect(row.disposition).toBe("new_billable");
    expect(row.quantity).toBe(3);
    expect(row.grounding_quote).toBe("please build three landing pages");
    expect(row.needs_review).toBe(true);
  });
});

describe("placementDisposition", () => {
  it("returns the explicit disposition when set", () => {
    expect(placementDisposition(p({ disposition: "out_of_scope" }))).toBe("out_of_scope");
    expect(placementDisposition(p({ disposition: "new_billable" }))).toBe("new_billable");
    expect(placementDisposition(p({ disposition: "in_agreed_scope" }))).toBe("in_agreed_scope");
  });

  it("falls back to is_inside for pre-0071 rows (disposition null)", () => {
    expect(placementDisposition(p({ disposition: null, is_inside: true }))).toBe("in_agreed_scope");
    expect(placementDisposition(p({ disposition: null, is_inside: false }))).toBe("new_billable");
  });
});

describe("isBillablePlacement", () => {
  it("is true only for new_billable", () => {
    expect(isBillablePlacement(p({ disposition: "new_billable" }))).toBe(true);
    expect(isBillablePlacement(p({ disposition: "in_agreed_scope" }))).toBe(false);
    expect(isBillablePlacement(p({ disposition: "out_of_scope" }))).toBe(false);
  });

  it("excludes out_of_scope items from the estimate", () => {
    const rows = [
      p({ task_ref: "a", disposition: "new_billable" }),
      p({ task_ref: "b", disposition: "out_of_scope" }),
      p({ task_ref: "c", disposition: "in_agreed_scope" }),
    ];
    expect(rows.filter(isBillablePlacement).map((r) => r.task_ref)).toEqual(["a"]);
  });

  it("treats legacy outside rows as billable (back-compat)", () => {
    expect(isBillablePlacement(p({ disposition: null, is_inside: false }))).toBe(true);
    expect(isBillablePlacement(p({ disposition: null, is_inside: true }))).toBe(false);
  });
});

describe("makeManualTaskRef", () => {
  it("builds a manual_ prefixed kebab slug from the first three words", () => {
    expect(makeManualTaskRef("Landing Page Build Page - No SEO", [])).toBe(
      "manual_landing-page-build",
    );
  });

  it("keeps the charset to [a-z0-9_-] (strips punctuation and accents collapse)", () => {
    expect(makeManualTaskRef("SEO Audit & Report!!", [])).toBe("manual_seo-audit-report");
  });

  it("falls back to a bare manual ref when the name yields no slug", () => {
    expect(makeManualTaskRef("", [])).toBe("manual");
    expect(makeManualTaskRef("   —  ", [])).toBe("manual");
  });

  it("suffixes -2, -3… to avoid colliding with existing refs on the brief", () => {
    const existing = ["manual_landing-page-build"];
    expect(makeManualTaskRef("Landing Page Build", existing)).toBe("manual_landing-page-build-2");
    expect(
      makeManualTaskRef("Landing Page Build", [...existing, "manual_landing-page-build-2"]),
    ).toBe("manual_landing-page-build-3");
  });

  it("suffixes the bare fallback too", () => {
    expect(makeManualTaskRef("", ["manual"])).toBe("manual-2");
  });

  it("never collides regardless of insertion order (accepts any iterable of refs)", () => {
    const taken = new Set(["manual_a", "manual_a-2"]);
    expect(makeManualTaskRef("A", taken)).toBe("manual_a-3");
  });
});
