// Run with: deno test supabase/functions/_shared/scope-map-logic.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildAnalyzeSystem,
  buildAnalyzeUser,
  buildSeedTasksForPlacement,
  buildSuggestUser,
  extractHeuristicAsks,
  extractText,
  heuristicQuantity,
  heuristicScopeItems,
  heuristicTitle,
  makeTaskRef,
  MAX_ESTIMATED_CENTS,
  parseScopeMapItems,
  parseSuggestedSlugs,
  pointsFromHours,
  truncate,
  type CatalogueService,
} from "./scope-map-logic.ts";

const SERVICES: CatalogueService[] = [
  {
    id: "svc-1",
    code: "SEO-AUDIT",
    name: "SEO audit",
    sell_price_cents: 450000,
    unit_of_sale: "audit",
    is_deliverable: true,
  },
  {
    id: "svc-2",
    code: "LP-BUILD",
    name: "Landing page build",
    sell_price_cents: 1200000,
    unit_of_sale: "page",
    is_deliverable: true,
  },
  // Non-deliverable SKU (spend / pass-through): must never be offered to the
  // model nor accepted as a matched code.
  {
    id: "svc-3",
    code: "AD-SPEND",
    name: "Ad spend",
    sell_price_cents: 0,
    unit_of_sale: "month",
    is_deliverable: false,
  },
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
      "reasoning": "Covered under 'monthly reporting' clause", "matched_service_code": null,
      "quantity": 1, "grounding_quote": "send me the monthly SEO report", "estimated_zar": null },
    { "item_name": "New landing page", "item_description": "Promo LP", "is_inside": false,
      "sow_slug": null, "service_area_id": null, "confidence": 0.8,
      "reasoning": "No web build deliverable in the SOW", "matched_service_code": "LP-BUILD",
      "quantity": 3, "grounding_quote": "build three new landing pages", "estimated_zar": 9999 }
  ]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items?.length, 2);
  assertEquals(items![0].sow_slug, "seo-retainer");
  assertEquals(items![0].service_area_id, "area-1");
  assertEquals(items![0].suggested_service_id, null);
  assertEquals(items![0].estimated_cents, null);
  assertEquals(items![0].matched_service_code, null);
  assertEquals(items![0].quantity, 1);
  assertEquals(items![0].grounding_quote, "send me the monthly SEO report");
  assertEquals(items![0].confidence, 0.9);
  assertEquals(items![1].is_inside, false);
  assertEquals(items![1].suggested_service_id, "svc-2");
  assertEquals(items![1].matched_service_code, "LP-BUILD");
  assertEquals(items![1].quantity, 3);
  assertEquals(items![1].grounding_quote, "build three new landing pages");
  // Catalogue price wins over estimated_zar.
  assertEquals(items![1].estimated_cents, 1200000);
});

Deno.test("parseScopeMapItems: whitelists matched_service_code, defaults quantity, drops invented/non-deliverable codes", () => {
  const text = `[
    { "item_name": "Made-up match", "item_description": "x", "is_inside": false,
      "sow_slug": null, "service_area_id": null, "confidence": 0.7,
      "reasoning": "", "matched_service_code": "NOT-A-REAL-CODE", "grounding_quote": null, "estimated_zar": null },
    { "item_name": "Spend match", "item_description": "x", "is_inside": false,
      "sow_slug": null, "service_area_id": null, "confidence": 0.7,
      "reasoning": "", "matched_service_code": "AD-SPEND", "quantity": 0, "grounding_quote": "  ", "estimated_zar": null }
  ]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  // Invented code → null, no quantity given → default 1.
  assertEquals(items![0].matched_service_code, null);
  assertEquals(items![0].suggested_service_id, null);
  assertEquals(items![0].quantity, 1);
  assertEquals(items![0].grounding_quote, null);
  // Non-deliverable code is never matchable → null; non-positive quantity → 1;
  // whitespace-only grounding quote → null.
  assertEquals(items![1].matched_service_code, null);
  assertEquals(items![1].suggested_service_id, null);
  assertEquals(items![1].quantity, 1);
  assertEquals(items![1].grounding_quote, null);
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

Deno.test("parseScopeMapItems: nulls negative estimated_zar", () => {
  const text = `[{ "item_name": "Refund-shaped item", "item_description": "x", "is_inside": false,
    "sow_slug": null, "service_area_id": null, "confidence": 0.5,
    "reasoning": "", "suggested_service_code": null, "estimated_zar": -500 }]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items![0].estimated_cents, null);
});

Deno.test("parseScopeMapItems: nulls estimated_zar that would overflow int4 cents", () => {
  const text = `[{ "item_name": "Hallucinated mega project", "item_description": "x", "is_inside": false,
    "sow_slug": null, "service_area_id": null, "confidence": 0.5,
    "reasoning": "", "suggested_service_code": null, "estimated_zar": 25000000 }]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items![0].estimated_cents, null);
});

Deno.test("parseScopeMapItems: keeps estimated_zar at the cap boundary and at zero", () => {
  const text = `[
    { "item_name": "At cap", "item_description": "x", "is_inside": false,
      "sow_slug": null, "service_area_id": null, "confidence": 0.5,
      "reasoning": "", "suggested_service_code": null, "estimated_zar": 20000000 },
    { "item_name": "Free", "item_description": "x", "is_inside": false,
      "sow_slug": null, "service_area_id": null, "confidence": 0.5,
      "reasoning": "", "suggested_service_code": null, "estimated_zar": 0 }
  ]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items![0].estimated_cents, MAX_ESTIMATED_CENTS);
  assertEquals(items![1].estimated_cents, 0);
});

Deno.test("parseScopeMapItems: catalogue price still wins over an out-of-range estimated_zar", () => {
  const text = `[{ "item_name": "LP", "item_description": "x", "is_inside": false,
    "sow_slug": null, "service_area_id": null, "confidence": 0.5,
    "reasoning": "", "suggested_service_code": "LP-BUILD", "estimated_zar": -1 }]`;
  const items = parseScopeMapItems(text, PARSE_OPTS);
  assertEquals(items![0].estimated_cents, 1200000);
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

// --- heuristic (no-AI) extraction ---

Deno.test("extractHeuristicAsks: pulls bullet items verbatim", () => {
  const body = "Hi team,\n\n- Build a new landing page\n- Set up a signup form\n\nThanks";
  const asks = extractHeuristicAsks("Winter campaign", body);
  assertEquals(asks.map((a) => a.text), ["Build a new landing page", "Set up a signup form"]);
  assertEquals(asks[0].quote, "- Build a new landing page");
});

Deno.test("extractHeuristicAsks: keeps prose sentences with an ask verb, drops sign-offs", () => {
  const body =
    "We'd like to build a new landing page for the winter campaign. It should match our brand styling. Kind regards, Sam.";
  const asks = extractHeuristicAsks("New landing page", body);
  const texts = asks.map((a) => a.text);
  assertEquals(texts.some((t) => t.includes("build a new landing page")), true);
  assertEquals(texts.some((t) => t.includes("match our brand styling")), true);
  assertEquals(texts.some((t) => t.toLowerCase().includes("kind regards")), false);
});

Deno.test("extractHeuristicAsks: falls back to the subject when nothing looks like an ask", () => {
  const asks = extractHeuristicAsks("Quarterly report question", "FYI. See attached. Cheers.");
  assertEquals(asks.length, 1);
  assertEquals(asks[0].text, "Quarterly report question");
  assertEquals(asks[0].quote, null);
});

Deno.test("extractHeuristicAsks: dedupes and caps at 25", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `- Build widget ${i % 5}`);
  const asks = extractHeuristicAsks("S", lines.join("\n"));
  assertEquals(asks.length, 5); // 5 unique, rest deduped
});

Deno.test("heuristicQuantity: parses leading counts, defaults to 1", () => {
  assertEquals(heuristicQuantity("3 landing pages"), 3);
  assertEquals(heuristicQuantity("three blog posts"), 3);
  assertEquals(heuristicQuantity("a signup form"), 1);
  assertEquals(heuristicQuantity("Build a landing page"), 1);
});

Deno.test("heuristicScopeItems: matches catalogue by keyword, flags needs_review via low confidence", () => {
  const items = heuristicScopeItems({
    subject: "Winter campaign",
    body: "- Build a new landing page\n- Send over the ad budget",
    services: SERVICES,
    slugs: ["seo-retainer"],
  });
  assertEquals(items.length, 2);

  const lp = items[0];
  assertEquals(lp.matched_service_code, "LP-BUILD");
  assertEquals(lp.suggested_service_id, "svc-2");
  assertEquals(lp.estimated_cents, 1200000);
  assertEquals(lp.sow_slug, "seo-retainer"); // sole slug groups matched items
  assertEquals(lp.grounding_quote, "- Build a new landing page");
  assertEquals(lp.confidence < 0.6, true); // always surfaced for human review

  // No deliverable keyword match → null code (→ out_of_scope downstream).
  assertEquals(items[1].matched_service_code, null);
  assertEquals(items[1].sow_slug, null);
});

Deno.test("heuristicScopeItems: never matches a non-deliverable SKU", () => {
  const items = heuristicScopeItems({
    subject: "S",
    body: "- Please cover the ad spend for us",
    services: SERVICES,
    slugs: [],
  });
  assertEquals(items.length, 1);
  assertEquals(items[0].matched_service_code, null); // AD-SPEND is non-deliverable
});

Deno.test("heuristicTitle: strips request preamble + lead verb, capitalises", () => {
  assertEquals(
    heuristicTitle("We'd like to put together a new landing page for our upcoming winter campaign"),
    "New landing page for our upcoming winter campaign",
  );
  assertEquals(heuristicTitle("Please set up Google Analytics"), "Google Analytics");
  assertEquals(heuristicTitle("We need a monthly SEO report"), "Monthly SEO report");
  assertEquals(heuristicTitle("Could you build the checkout flow"), "Checkout flow");
});

Deno.test("heuristicTitle: keeps a bare noun phrase and preserves internal filler words", () => {
  // No leading filler → returned as-is (just capitalised).
  assertEquals(heuristicTitle("Blog posts for the launch"), "Blog posts for the launch");
});

Deno.test("heuristicTitle: falls back to the cleaned ask when stripping leaves too little", () => {
  // All-filler-ish ask: <2 content words survive, so the original is kept.
  assertEquals(heuristicTitle("Please help us"), "Please help us");
});

Deno.test("heuristicTitle: trims to <=60 chars on a word boundary, no ellipsis", () => {
  const title = heuristicTitle(
    "Build a comprehensive multi-channel marketing dashboard with realtime revenue tracking",
  );
  assertEquals(title.length <= 60, true);
  assertEquals(title.endsWith("…"), false);
  assertEquals(title.endsWith(" "), false);
});

Deno.test("heuristicScopeItems: title is distinct from the full-sentence description", () => {
  const items = heuristicScopeItems({
    subject: "Winter campaign",
    body: "We'd like to put together a new landing page for our upcoming winter campaign",
    services: SERVICES,
    slugs: [],
  });
  assertEquals(items.length, 1);
  assertEquals(items[0].item_name, "New landing page for our upcoming winter campaign");
  assertEquals(
    items[0].item_description,
    "We'd like to put together a new landing page for our upcoming winter campaign",
  );
  assertEquals(items[0].item_name === items[0].item_description, false);
});

Deno.test("heuristicScopeItems: leaves sow_slug null when multiple SOWs are selected", () => {
  const items = heuristicScopeItems({
    subject: "S",
    body: "- Build a new landing page",
    services: SERVICES,
    slugs: ["seo-retainer", "web-dev"],
  });
  assertEquals(items[0].matched_service_code, "LP-BUILD");
  assertEquals(items[0].sow_slug, null);
});

// --- team-task seeding ---

Deno.test("pointsFromHours: 4 pt/hr, 2dp, non-positive → 0", () => {
  assertEquals(pointsFromHours(5.12), 20.48);
  assertEquals(pointsFromHours(1), 4);
  assertEquals(pointsFromHours(0), 0);
  assertEquals(pointsFromHours(-3), 0);
});

Deno.test("buildSeedTasksForPlacement: prefers authored process steps, scales by quantity", () => {
  const rows = buildSeedTasksForPlacement({
    placementId: "pl-1",
    briefId: "br-1",
    quantity: 2,
    serviceName: "Landing page build",
    steps: [
      { ordinal: 2, title: "Build", department_id: "dev", estimated_hours: 3 },
      { ordinal: 1, title: "Design", department_id: "creative", estimated_hours: 1.5 },
    ],
    allocation: [{ department_id: "dev", hours: 5 }],
  });
  // Ordered by ordinal; allocation ignored when steps exist.
  assertEquals(rows.map((r) => r.title), ["Design", "Build"]);
  assertEquals(rows[0].hours, 3); // 1.5 × 2
  assertEquals(rows[0].points, 12);
  assertEquals(rows[1].hours, 6); // 3 × 2
  assertEquals(rows[1].points, 24);
  assertEquals(rows[0].sort_order, 0);
  assertEquals(rows[0].brief_id, "br-1");
  assertEquals(rows[0].placement_id, "pl-1");
});

Deno.test("buildSeedTasksForPlacement: falls back to department allocation, hours desc", () => {
  const rows = buildSeedTasksForPlacement({
    placementId: "pl-1",
    briefId: "br-1",
    quantity: 1,
    serviceName: "Landing page build",
    steps: [],
    allocation: [
      { department_id: "pm", hours: 0 }, // dropped (0h)
      { department_id: "dev", hours: 5.12 },
      { department_id: "creative", hours: 2 },
    ],
  });
  assertEquals(rows.length, 2);
  assertEquals(rows[0].department_id, "dev"); // highest hours first
  assertEquals(rows[0].hours, 5.12);
  assertEquals(rows[0].points, 20.48);
  assertEquals(rows[0].title, "Landing page build");
  assertEquals(rows[1].department_id, "creative");
});

Deno.test("buildSeedTasksForPlacement: ignores hourless placeholder steps, uses allocation", () => {
  // A service whose only process_step is an empty "New step" stub must not seed
  // a useless 0h task — the real department allocation should win.
  const rows = buildSeedTasksForPlacement({
    placementId: "pl-1",
    briefId: "br-1",
    quantity: 1,
    serviceName: "Landing page build",
    steps: [{ ordinal: 1, title: "New step", department_id: null, estimated_hours: null }],
    allocation: [{ department_id: "dev", hours: 5.12 }],
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].department_id, "dev");
  assertEquals(rows[0].hours, 5.12);
  assertEquals(rows[0].points, 20.48);
  assertEquals(rows[0].title, "Landing page build");
});

Deno.test("buildSeedTasksForPlacement: last-resort single task when no steps or allocation", () => {
  const rows = buildSeedTasksForPlacement({
    placementId: "pl-1",
    briefId: "br-1",
    quantity: 3,
    serviceName: "Mystery deliverable",
    steps: [],
    allocation: [],
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].title, "Mystery deliverable");
  assertEquals(rows[0].hours, 0);
  assertEquals(rows[0].points, 0);
  assertEquals(rows[0].department_id, null);
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
  // New catalogue format: code | name | unit_of_sale | price.
  assertStringIncludes(system, "SEO-AUDIT | SEO audit | audit | R4500");
  // Non-deliverable SKUs are never offered to the model.
  assertEquals(system.includes("AD-SPEND"), false);
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

Deno.test("buildAnalyzeUser: caps extraction at 25 asks and bounds reasoning length", () => {
  const user = buildAnalyzeUser({ subject: "S", body: "B", scope: null });
  assertStringIncludes(user, "25 most substantive asks");
  assertStringIncludes(user, "200 characters or fewer");
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
