// Pure logic for the analyze-brief-sow edge function (Scope Map).
// No side effects, no external calls — fully testable. Mirrors auto-scope-logic.ts.

export type SowSummary = { slug: string; title: string };
export type SowWithBody = { slug: string; title: string; body_md: string };
export type ServiceArea = { id: string; name: string; sow_slug: string };
export type CatalogueService = {
  id: string;
  code: string;
  name: string;
  sell_price_cents: number;
};
export type ScopeRow = {
  enhanced_prose: string | null;
  in_scope_md: string | null;
  out_of_scope_md: string | null;
  open_questions_md: string | null;
};

/** Insert-ready placement extracted from the AI response. */
export type ParsedScopeItem = {
  item_name: string;
  item_description: string;
  is_inside: boolean;
  sow_slug: string | null;
  service_area_id: string | null;
  ai_confidence: number;
  ai_match_quote: string;
  suggested_service_id: string | null;
  estimated_cents: number | null;
};

export const BRIEF_BODY_MAX_CHARS = 8000;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

/** Pull the text blocks out of an Anthropic Messages API response. */
export function extractText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const content = (raw as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => c.text ?? "").join("");
}

/**
 * task_ref for an extracted item: `item_{i}_` + kebab of the first three
 * words of the item name. Deterministic so re-analysis of an unchanged brief
 * tends to produce stable refs.
 */
export function makeTaskRef(index: number, itemName: string): string {
  const kebab = itemName
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join("-");
  return kebab ? `item_${index}_${kebab}` : `item_${index}`;
}

// ---------------------------------------------------------------------------
// Suggest mode — which SOW engagements does this client likely have?
// ---------------------------------------------------------------------------

export const SUGGEST_SYSTEM = [
  "You are an account analyst at Converted Click, a digital marketing agency.",
  "Given the agency's master Statement-of-Work (SOW) catalogue and an inbound client email,",
  "suggest which SOW engagements this client most likely already has with the agency.",
  "Only pick SOWs that are plausibly implied by the email's content; fewer is better.",
  'Return ONLY a JSON array of slugs, e.g. ["seo-retainer","paid-media"]. Return [] if unsure.',
].join("\n");

export function buildSuggestUser(opts: {
  sows: SowSummary[];
  subject: string;
  body: string;
}): string {
  const list = opts.sows.map((s) => `- slug=${s.slug} · title="${s.title}"`).join("\n");
  return [
    "# Master SOW catalogue",
    list || "(none)",
    "",
    `Subject: ${opts.subject}`,
    "",
    "Body:",
    truncate(opts.body, 4000),
  ].join("\n");
}

/** Parse the suggest call. Unknown slugs and duplicates are dropped; [] on failure. */
export function parseSuggestedSlugs(
  text: string,
  knownSlugs: ReadonlySet<string>,
): string[] {
  const m = text.trim().match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const v of parsed) {
      const slug = typeof v === "string"
        ? v
        : v && typeof v === "object" && typeof (v as { slug?: unknown }).slug === "string"
          ? (v as { slug: string }).slug
          : null;
      if (slug && knownSlugs.has(slug) && !out.includes(slug)) out.push(slug);
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Analyze mode — extract asks from the brief, classify against SOW bodies
// ---------------------------------------------------------------------------

export function buildAnalyzeSystem(opts: {
  sows: SowWithBody[];
  serviceAreas: ServiceArea[];
  services: CatalogueService[];
}): string {
  const sowBlocks = opts.sows
    .map((s) => `## SOW: ${s.title} (slug: ${s.slug})\n${s.body_md}`)
    .join("\n\n");
  const areaList = opts.serviceAreas
    .map((a) => `- id=${a.id} · name="${a.name}" · sow=${a.sow_slug}`)
    .join("\n");
  const catalogue = opts.services
    .map((s) => `${s.code} | ${s.name} | R${(s.sell_price_cents / 100).toFixed(0)}`)
    .join("\n");
  return [
    "You are a scoping analyst at Converted Click, a digital marketing agency.",
    "You compare an inbound client request against the client's signed Statements of Work (SOWs)",
    "to decide which asks are covered (inside scope) and which fall outside.",
    "Be precise: only mark an ask inside when an SOW clause clearly covers it. Do not invent commitments.",
    "",
    "# Signed SOWs",
    sowBlocks,
    "",
    "# Service areas (optional grouping — use these uuids for inside items when one clearly applies)",
    areaList || "(none defined)",
    "",
    "# Service catalogue (code | name | price) — use codes to suggest a delivery service for OUTSIDE items",
    catalogue || "(none)",
  ].join("\n");
}

export function buildAnalyzeUser(opts: {
  subject: string;
  body: string;
  scope: ScopeRow | null;
}): string {
  const parts: string[] = [
    `Subject: ${opts.subject}`,
    "",
    "Body:",
    truncate(opts.body, BRIEF_BODY_MAX_CHARS),
  ];

  if (opts.scope) {
    const s = opts.scope;
    const scopeParts: string[] = [];
    if (s.enhanced_prose) scopeParts.push(`Summary:\n${s.enhanced_prose}`);
    if (s.in_scope_md) scopeParts.push(`In scope (draft):\n${s.in_scope_md}`);
    if (s.out_of_scope_md) scopeParts.push(`Out of scope (draft):\n${s.out_of_scope_md}`);
    if (s.open_questions_md) scopeParts.push(`Open questions:\n${s.open_questions_md}`);
    if (scopeParts.length > 0) {
      parts.push("", "# Draft scope notes (AI-prepared, may be incomplete)", scopeParts.join("\n\n"));
    }
  }

  parts.push(
    "",
    "# Instructions",
    "Extract every discrete ask the client is making in this request, then classify each ask against the SOWs in the system prompt.",
    "Return ONLY a JSON array, nothing else. Each element:",
    '{ "item_name": "<short label, max 60 chars>",',
    '  "item_description": "<what the client wants, one or two sentences>",',
    '  "is_inside": <true if covered by one of the SOWs, else false>,',
    '  "sow_slug": "<slug of the SOW that covers it; null if outside all>",',
    '  "service_area_id": "<uuid from the service-area list, or null>",',
    '  "confidence": <0..1>,',
    '  "reasoning": "<max 200 chars; quote or cite the SOW clause for inside items; explain the gap for outside items>",',
    '  "suggested_service_code": "<catalogue code that would deliver it, for OUTSIDE items, else null>",',
    '  "estimated_zar": <ballpark rand amount if no catalogue code fits, else null> }',
  );
  return parts.join("\n");
}

/**
 * Parse the analyze call into insert-ready items.
 * - null on non-JSON output (caller returns 502);
 * - drops elements missing item_name / is_inside;
 * - clamps confidence to 0..1;
 * - whitelists sow_slug to the selected SOW set;
 * - whitelists service_area_id to the loaded areas;
 * - maps suggested_service_code → catalogue row (suggested_service_id +
 *   estimated_cents = sell_price_cents), else estimated_cents from
 *   estimated_zar when given, else null.
 */
export function parseScopeMapItems(
  text: string,
  opts: {
    allowedSlugs: ReadonlySet<string>;
    serviceAreaIds: ReadonlySet<string>;
    services: CatalogueService[];
  },
): ParsedScopeItem[] | null {
  const trimmed = text.trim();
  const m = trimmed.match(/\[[\s\S]*\]/);
  const jsonStr = m ? m[0] : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const byCode = new Map(opts.services.map((s) => [s.code, s]));
  const items: ParsedScopeItem[] = [];

  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.item_name !== "string" || r.item_name.trim() === "") continue;
    if (typeof r.is_inside !== "boolean") continue;

    const sowSlug = typeof r.sow_slug === "string" && opts.allowedSlugs.has(r.sow_slug)
      ? r.sow_slug
      : null;
    const areaId =
      typeof r.service_area_id === "string" && opts.serviceAreaIds.has(r.service_area_id)
        ? r.service_area_id
        : null;

    const service = typeof r.suggested_service_code === "string"
      ? byCode.get(r.suggested_service_code) ?? null
      : null;
    const estimatedZar =
      typeof r.estimated_zar === "number" && Number.isFinite(r.estimated_zar)
        ? r.estimated_zar
        : null;
    const estimatedCents = service
      ? service.sell_price_cents
      : estimatedZar !== null
        ? Math.round(estimatedZar * 100)
        : null;

    items.push({
      item_name: r.item_name.trim().slice(0, 120),
      item_description: typeof r.item_description === "string" ? r.item_description.trim() : "",
      is_inside: r.is_inside,
      sow_slug: sowSlug,
      service_area_id: areaId,
      ai_confidence: clamp(Number(r.confidence) || 0, 0, 1),
      ai_match_quote: typeof r.reasoning === "string" ? r.reasoning.trim().slice(0, 400) : "",
      suggested_service_id: service?.id ?? null,
      estimated_cents: estimatedCents,
    });
  }
  return items;
}
