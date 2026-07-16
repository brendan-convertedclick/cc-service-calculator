import { describe, expect, it } from "vitest";
import {
  intelligenceScopeItems,
  type AssumedExclusion,
  type CatalogueService,
  type IntelligenceRequirement,
} from "../../supabase/functions/_shared/scope-map-logic";

const services: CatalogueService[] = [
  {
    id: "svc-lp",
    code: "002",
    name: "Landing Page Build",
    sell_price_cents: 330000,
    unit_of_sale: "per page",
    is_deliverable: true,
  } as unknown as CatalogueService,
  {
    id: "svc-copy",
    code: "014",
    name: "Copywriting",
    sell_price_cents: 90000,
    unit_of_sale: "per page",
    is_deliverable: true,
  } as unknown as CatalogueService,
];

describe("intelligenceScopeItems — scope coverage (0087)", () => {
  const requirements: IntelligenceRequirement[] = [
    {
      item_title: "Landing Page Build — Winter campaign",
      text: "we need a landing page for the winter promo",
      interpretation: "One campaign landing page on the existing site",
      confidence: "high",
      mapped_services: [{ service_id: "svc-lp", qty: 1 }],
      coverage_reason: "Not part of your current retainer — quoted as new work.",
      expected_disposition: "new_billable",
    },
  ];

  it("carries coverage_reason + expected_disposition from the requirement", () => {
    const items = intelligenceScopeItems({ requirements, services, slugs: [] });
    expect(items).toHaveLength(1);
    expect(items[0].coverage_reason).toMatch(/quoted as new work/);
    expect(items[0].expected_disposition).toBe("new_billable");
    expect(items[0].is_assumed).toBe(false);
  });

  it("normalizes an invalid expected_disposition to null", () => {
    const items = intelligenceScopeItems({
      requirements: [{ ...requirements[0], expected_disposition: "maybe" }],
      services,
      slugs: [],
    });
    expect(items[0].expected_disposition).toBeNull();
  });

  it("emits one is_assumed item per assumed exclusion, mapped or not", () => {
    const assumed: AssumedExclusion[] = [
      {
        item_title: "Copywriting — landing page",
        assumption: "Page copy is written for us as part of the build",
        reason: "Copywriting isn't part of a landing-page build.",
        mapped_services: [{ service_id: "svc-copy", qty: 1 }],
      },
      {
        item_title: "Hosting & domain",
        assumption: "Hosting is handled for us",
        reason: "Hosting isn't a service we provide under this agreement.",
      },
    ];
    const items = intelligenceScopeItems({
      requirements,
      services,
      slugs: [],
      assumedExclusions: assumed,
    });
    expect(items).toHaveLength(3);
    const [, copy, hosting] = items;
    expect(copy.is_assumed).toBe(true);
    expect(copy.matched_service_code).toBe("014");
    expect(copy.coverage_reason).toMatch(/Copywriting isn't part/);
    expect(copy.grounding_quote).toMatch(/written for us/);
    expect(hosting.is_assumed).toBe(true);
    expect(hosting.matched_service_code).toBeNull();
    expect(hosting.item_name).toBe("Hosting & domain");
  });

  it("skips empty assumed exclusions", () => {
    const items = intelligenceScopeItems({
      requirements,
      services,
      slugs: [],
      assumedExclusions: [{}, { reason: "orphan reason with no title" }],
    });
    expect(items).toHaveLength(1);
  });
});
