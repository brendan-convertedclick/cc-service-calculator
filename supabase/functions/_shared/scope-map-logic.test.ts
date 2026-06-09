// Run with: deno test supabase/functions/_shared/scope-map-logic.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildAnalyzeSystem,
  buildAnalyzeUser,
  buildSuggestUser,
  extractText,
  makeTaskRef,
  parseScopeMapItems,
  parseSuggestedSlugs,
  truncate,
  type CatalogueService,
} from "./scope-map-logic.ts";

const SERVICES: CatalogueService[] = [
  { id: "svc-1", code: "SEO-AUDIT", name: "SEO audit", sell_price_cents: 450000 },
  { id: "svc-2", code: "LP-BUILD", name: "Landing page build", sell_price_cents: 1200000 },
];

// --- makeTaskRef ---

Deno.test("makeTaskRef: kebab of first three words", () => {
  assertEquals(makeTaskRef(0, "New landing page for promo"), "item_0_new-landing-page");
});

Deno.test("makeTaskRef: strips punctuation and handles short names", () => {
  assertEquals(makeTaskRef(3, "Fix SEO!"), "item_3_fix-seo");
});

Deno.test("makeTaskRef: falls back to bare index when name has no usable chars", () => {
  assertEquals(makeTaskRef(2, "—— ··"), "item_2");
});

// --- parseSuggestedSlugs ---

Deno.test("parseSuggestedSlugs: filters to known slugs, dedupes, keeps order", () => {
  const known = new Set(["seo-retainer", "paid-media", "web-dev"]);
  const text = 'Likely engagements:\n["seo-retainer","made-up","paid-media","seo-retainer"]';
  assertEquals(parseSuggestedSlugs(text, known), ["seo-retainer", "paid-media"]);
});

Deno.test("parseSuggestedSlugs: accepts objects with a slug field", () => {
  const known = new Set(["web-dev"]);
  assertEquals(parseSuggestedSlugs('[{"slug":"web-dev","why":"site"}]', known), ["web-dev"]);
});

Deno.test("parseSuggestedSlugs: returns [] on non-JSON output", () => {
  assertEquals(parseSuggestedSlugs("I am not sure.", new Set(["a"])), []);
});

// --- parseScopeMapItems ---

const PARSE_OPTS = {
  allowedSlugs: new Set(["seo-retainer"]),
  serviceAreaIds: new Set(["area-1"]),
  services: SERVICES,
};

Deno.test("parseScopeMapItems: extracts array embedded in prose, maps catalogue code", () => {
  const text = `Here you go:\n[
    { "item_name": "Monthly SEO report", "item_description": "Recurring report", "is_inside": true,
      "sow_slug": "seo-retainer", "service_area_id": "area-1", "confidence": 0.9,
      "reasoning": "Covered under 'monthly reporting' clause", "suggested_service_code": null, "estimated_zar": null },
    { "item_name": "New landing page", "item_description": "Promo LP", "is_inside": false,
      "sow_slug": null, "service_area_id": null, "confidence": 0.8,
      "reasoning": "No web build deliverable in the SOW", "suggested_service_code": "LP-BUILD", "estimated_zar": 9999 }
  ]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items?.length, 2);
  assertEquals(items![0].sow_slug, "seo-retainer");
  assertEquals(items![0].service_area_id, "area-1");
  assertEquals(items![0].suggested_service_id, null);
  assertEquals(items![0].estimated_cents, null);
  assertEquals(items![1].is_inside, false);
  assertEquals(items![1].suggested_service_id, "svc-2");
  // Catalogue price wins over estimated_zar.
  assertEquals(items![1].estimated_cents, 1200000);
});

Deno.test("parseScopeMapItems: whitelists sow_slug and service_area_id", () => {
  const text = `[{ "item_name": "Thing", "item_description": "", "is_inside": true,
    "sow_slug": "not-selected", "service_area_id": "bogus-area", "confidence": 0.5,
    "reasoning": "", "suggested_service_code": null, "estimated_zar": null }]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items![0].sow_slug, null);
  assertEquals(items![0].service_area_id, null);
});

Deno.test("parseScopeMapItems: clamps confidence and converts estimated_zar to cents", () => {
  const text = `[{ "item_name": "Ballpark item", "item_description": "x", "is_inside": false,
    "sow_slug": null, "service_area_id": null, "confidence": 1.7,
    "reasoning": "gap", "suggested_service_code": "UNKNOWN-CODE", "estimated_zar": 1234.56 }]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items![0].ai_confidence, 1);
  assertEquals(items![0].suggested_service_id, null);
  assertEquals(items![0].estimated_cents, 123456);
});

Deno.test("parseScopeMapItems: drops malformed elements, keeps valid ones", () => {
  const text = `[
    { "item_name": "", "is_inside": true },
    { "item_name": "Valid", "is_inside": "yes" },
    "junk",
    { "item_name": "Kept", "item_description": "d", "is_inside": true, "confidence": 0.4, "reasoning": "r" }
  ]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items?.length, 1);
  assertEquals(items![0].item_name, "Kept");
  assertEquals(items![0].estimated_cents, null);
});

Deno.test("parseScopeMapItems: returns null on non-JSON output", () => {
  assertEquals(parseScopeMapItems("Sorry, I cannot help.", PARSE_OPTS), null);
});

// --- prompt builders ---

Deno.test("buildAnalyzeSystem: includes SOW headers, areas, and catalogue lines", () => {
  const system = buildAnalyzeSystem({
    sows: [{ slug: "seo-retainer", title: "SEO Retainer", body_md: "Monthly reporting." }],
    serviceAreas: [{ id: "area-1", name: "Reporting", sow_slug: "seo-retainer" }],
    services: SERVICES,
  });
  assertStringIncludes(system, "## SOW: SEO Retainer (slug: seo-retainer)");
  assertStringIncludes(system, "Monthly reporting.");
  assertStringIncludes(system, 'id=area-1 · name="Reporting" · sow=seo-retainer');
  assertStringIncludes(system, "SEO-AUDIT | SEO audit | R4500");
});

Deno.test("buildAnalyzeSystem: shows placeholders when areas/catalogue empty", () => {
  const system = buildAnalyzeSystem({
    sows: [{ slug: "a", title: "A", body_md: "b" }],
    serviceAreas: [],
    services: [],
  });
  assertStringIncludes(system, "(none defined)");
});

Deno.test("buildAnalyzeUser: truncates long bodies and includes scope notes", () => {
  const user = buildAnalyzeUser({
    subject: "Hello",
    body: "x".repeat(9000),
    scope: {
      enhanced_prose: "Clarified summary",
      in_scope_md: "- thing",
      out_of_scope_md: null,
      open_questions_md: null,
    },
  });
  assertStringIncludes(user, "…[truncated]");
  assertStringIncludes(user, "Clarified summary");
  assertStringIncludes(user, "In scope (draft):");
  assertStringIncludes(user, "Return ONLY a JSON array");
});

Deno.test("buildAnalyzeUser: omits scope section when scope is null", () => {
  const user = buildAnalyzeUser({ subject: "S", body: "B", scope: null });
  assertEquals(user.includes("Draft scope notes"), false);
});

Deno.test("buildSuggestUser: lists catalogue and brief content", () => {
  const user = buildSuggestUser({
    sows: [{ slug: "seo-retainer", title: "SEO Retainer" }],
    subject: "Need help",
    body: "Our rankings dropped",
  });
  assertStringIncludes(user, 'slug=seo-retainer · title="SEO Retainer"');
  assertStringIncludes(user, "Subject: Need help");
});

// --- helpers ---

Deno.test("extractText: joins content text blocks", () => {
  assertEquals(extractText({ content: [{ type: "text", text: "a" }, { text: "b" }] }), "ab");
  assertEquals(extractText(null), "");
  assertEquals(extractText({ content: "nope" }), "");
});

Deno.test("truncate: passes short text through unchanged", () => {
  assertEquals(truncate("short", 100), "short");
});
