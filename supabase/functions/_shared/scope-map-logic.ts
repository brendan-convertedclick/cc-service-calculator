// Pure logic for the analyze-brief-sow edge function (Scope Map).
// No side effects, no external calls — fully testable. Mirrors auto-scope-logic.ts.

export type SowSummary = { slug: string; title: string };
export type SowWithBody = { slug: string; title: string; body_md: string };
export type ServiceArea = { id: string; name: string; sow_slug: string };
export type CatalogueService = {
  id: string;
  /** Xero code; null for internal-only SKUs (matchable via serviceCodeKey). */
  code: string | null;
  name: string;
  sell_price_cents: number;
  /** Unit the SKU is sold by (e.g. "page", "month", "hour"). Optional for legacy callers. */
  unit_of_sale?: string | null;
  /**
   * Whether the SKU is an actual deliverable (vs. spend / pass-through /
   * software). Only deliverable services are fed to the model and accepted as
   * a `matched_service_code`. Optional so legacy callers/tests still compile;
   * treated as deliverable when absent.
   */
  is_deliverable?: boolean;
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
  // --- Scope Ledger Rail fields (mirror ExtractedAsk in scope-disposition.ts) ---
  /**
   * Xero catalog code the model matched, whitelisted to a real deliverable
   * service code; null when nothing fits or the model invented a code.
   */
  matched_service_code: string | null;
  /** How many of the matched unit the client is asking for. Defaults to 1. */
  quantity: number;
  /** Verbatim substring of the brief that grounds this ask; null if absent. */
  grounding_quote: string | null;
  /** 0..1 model confidence (alias of ai_confidence under the Rail naming). */
  confidence: number;
};

export const BRIEF_BODY_MAX_CHARS = 8000;

/**
 * Ceiling for AI ballpark estimates: R20M in cents, safely inside int4
 * (estimated_cents column, max 2,147,483,647). Out-of-range values → null.
 */
export const MAX_ESTIMATED_CENTS = 2_000_000_000;

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
  // Only deliverable services are offered to the model: it must never match an
  // ask to a spend / pass-through / software SKU.
  const catalogue = opts.services
    .filter((s) => s.is_deliverable !== false && s.code)
    .map(
      (s) =>
        `${s.code} | ${s.name} | ${s.unit_of_sale ?? "unit"} | R${(s.sell_price_cents / 100).toFixed(0)}`,
    )
    .join("\n");
  return [
    "You are a scoping analyst at Converted Click, a digital marketing agency.",
    "You compare an inbound client request against the client's signed Statements of Work (SOWs)",
    "to decide which asks are covered (inside scope) and which fall outside.",
    "Be precise: only mark an ask inside when an SOW clause clearly covers it. Do not invent commitments.",
    "",
    "For EVERY discrete ask you must also identify WHAT the client is asking for and WHICH catalogue",
    "item delivers it, and HOW MANY of that item's unit are needed. Match to a catalogue code ONLY",
    "when an item clearly delivers the ask; return null for the code when nothing in the catalogue fits.",
    "Do NOT decide whether the ask is paid, billable, or already covered by the retainer/agreement —",
    "that is computed downstream. Your job is extraction and catalogue matching only.",
    "",
    "# Signed SOWs",
    sowBlocks,
    "",
    "# Service areas (optional grouping — use these uuids for inside items when one clearly applies)",
    areaList || "(none defined)",
    "",
    "# Service catalogue (code | name | unit_of_sale | price) — match every ask to one of these codes (or null)",
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
    "Cap the extraction at the 25 most substantive asks — if there are more, keep only the 25 that matter most.",
    'Keep every "reasoning" value at 200 characters or fewer.',
    "For each ask, decide WHICH catalogue code delivers it and HOW MANY of that code's unit are needed (quantity).",
    "Do NOT decide whether the ask is paid or in-scope — only extract, match a catalogue code (or null), and count.",
    'Set "grounding_quote" to a short VERBATIM substring copied exactly from the brief body above that proves this ask was requested.',
    "Return ONLY a JSON array, nothing else. Each element:",
    '{ "item_name": "<short label, max 60 chars>",',
    '  "item_description": "<what the client wants, one or two sentences>",',
    '  "is_inside": <true if covered by one of the SOWs, else false>,',
    '  "sow_slug": "<slug of the SOW that covers it; null if outside all>",',
    '  "service_area_id": "<uuid from the service-area list, or null>",',
    '  "confidence": <0..1>,',
    '  "reasoning": "<max 200 chars; quote or cite the SOW clause for inside items; explain the gap for outside items>",',
    '  "matched_service_code": "<the catalogue code that delivers this ask, or null if nothing fits>",',
    '  "quantity": <how many of that catalogue unit are asked for; a positive number, default 1>,',
    '  "grounding_quote": "<verbatim substring of the brief proving this ask, or null>",',
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
 * - whitelists matched_service_code (or the legacy suggested_service_code) to a
 *   real DELIVERABLE catalogue code; any invented/non-deliverable code → null;
 * - maps the matched code → catalogue row (suggested_service_id +
 *   estimated_cents = sell_price_cents), else estimated_cents from
 *   estimated_zar when given and within [0, MAX_ESTIMATED_CENTS]
 *   (negative/overflow → null, mirroring the confidence clamp), else null;
 * - parses quantity as a positive number, defaulting to 1 when absent/invalid;
 * - captures grounding_quote (verbatim brief substring) when a string.
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

  // Whitelist target: only DELIVERABLE codes are matchable. A matched_service_code
  // that isn't here (invented or non-deliverable) is dropped to null.
  const byCode = new Map(
    opts.services
      .filter((s) => s.is_deliverable !== false && s.code)
      .map((s) => [s.code as string, s]),
  );
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

    // New Rail field (matched_service_code); fall back to the legacy
    // suggested_service_code so older prompts/callers still resolve a service.
    const rawCode =
      typeof r.matched_service_code === "string"
        ? r.matched_service_code
        : typeof r.suggested_service_code === "string"
          ? r.suggested_service_code
          : null;
    const service = rawCode !== null ? byCode.get(rawCode) ?? null : null;
    // Whitelist to a real deliverable code; invented/non-deliverable → null.
    const matchedServiceCode = service ? service.code : null;

    // Quantity: keep the parsed positive number; default 1 only when absent/invalid.
    const rawQty = Number(r.quantity);
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;

    const groundingQuote =
      typeof r.grounding_quote === "string" && r.grounding_quote.trim() !== ""
        ? r.grounding_quote.trim().slice(0, 2000)
        : null;

    const estimatedZar =
      typeof r.estimated_zar === "number" && Number.isFinite(r.estimated_zar)
        ? r.estimated_zar
        : null;
    const rawCents = estimatedZar !== null ? Math.round(estimatedZar * 100) : null;
    const estimatedCents = service
      ? service.sell_price_cents
      : rawCents !== null &&
          Number.isFinite(rawCents) &&
          rawCents >= 0 &&
          rawCents <= MAX_ESTIMATED_CENTS
        ? rawCents
        : null;

    const aiConfidence = clamp(Number(r.confidence) || 0, 0, 1);

    items.push({
      item_name: r.item_name.trim().slice(0, 120),
      item_description: typeof r.item_description === "string" ? r.item_description.trim() : "",
      is_inside: r.is_inside,
      sow_slug: sowSlug,
      service_area_id: areaId,
      ai_confidence: aiConfidence,
      ai_match_quote: typeof r.reasoning === "string" ? r.reasoning.trim().slice(0, 400) : "",
      suggested_service_id: service?.id ?? null,
      estimated_cents: estimatedCents,
      matched_service_code: matchedServiceCode,
      quantity,
      grounding_quote: groundingQuote,
      confidence: aiConfidence,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Heuristic (no-AI) extraction — deterministic fallback used when
// ANTHROPIC_API_KEY is unavailable or the analyze call fails. It extracts
// discrete asks from the brief text and keyword-matches each to a deliverable
// catalogue code, producing the SAME ParsedScopeItem[] shape the LLM path
// yields. resolveDisposition then assigns the in/new/out bucket identically for
// heuristic and AI output. Every item is emitted with confidence < 0.6 so the
// downstream needs_review flag is set — heuristic matches are always surfaced
// for a human to confirm.
// ---------------------------------------------------------------------------

const HEURISTIC_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on", "at", "by",
  "with", "our", "your", "their", "we", "you", "they", "it", "this", "that",
  "these", "those", "is", "are", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "should", "could", "can", "may", "might",
  "must", "us", "me", "as", "from", "into", "via", "per", "new", "also", "please",
  "some", "any", "all", "more", "if", "so", "then", "want", "need", "like", "get",
  "make", "let", "would", "well", "just",
]);

// Words that signal a client is asking for something (used to keep prose
// sentences that read like an ask and drop pleasantries/sign-offs).
const HEURISTIC_ASK_VERBS = [
  "build", "create", "design", "develop", "set up", "setup", "add", "update",
  "refresh", "revamp", "redesign", "produce", "write", "launch", "run",
  "optimise", "optimize", "manage", "capture", "migrate", "integrate", "install",
  "configure", "generate", "deliver", "provide", "require", "request", "prepare",
  "plan", "need", "want", "would like", "put together", "help", "roll out",
  "implement", "fix", "improve", "highlight", "match", "make",
];

const HEURISTIC_ASK_VERB_RE = new RegExp(
  `\\b(?:${HEURISTIC_ASK_VERBS.map((v) => v.replace(/ /g, "\\s+")).join("|")})(?:s|d|ing)?\\b`,
  "i",
);

const HEURISTIC_NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function heuristicNormalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function heuristicTokens(s: string): string[] {
  return heuristicNormalize(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !HEURISTIC_STOPWORDS.has(t));
}

function heuristicCleanAsk(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[.;:,\s]+$/, "");
}

// Leading filler the heuristic strips when synthesising a short title from an
// ask sentence: greetings, pronouns, politeness, auxiliaries, desire verbs,
// prepositions, determiners — plus every lead action verb (so "We'd like to
// put together a new landing page…" → "New landing page…"). Only a LEADING run
// of these is removed; the first content word stops the strip, so words that
// double as filler ("for", "our") survive mid-phrase.
const HEURISTIC_TITLE_FILLER = new Set<string>([
  "hi", "hello", "hey", "please", "kindly", "just", "also", "really", "so",
  "we", "i", "you", "they", "our", "my", "your", "us", "team",
  "we'd", "i'd", "we'll", "i'll", "you'd", "we're", "we've",
  "would", "will", "d", "ll", "do", "does", "are", "were", "was", "have",
  "has", "had", "can", "could", "should", "keen",
  "need", "want", "like", "love", "hope", "hoping", "looking", "wondering",
  "to", "for", "on", "with", "a", "an", "the", "some", "this", "that",
  ...HEURISTIC_ASK_VERBS.flatMap((v) => v.split(" ")),
]);

/**
 * Synthesise a short, distinct title from a full ask sentence — used by the
 * heuristic (no-AI) path so the item's name isn't just a truncation of its
 * description. Strips a leading run of filler/politeness/lead-verb words, one
 * leading determiner, capitalises the first letter (preserving acronyms), and
 * trims to <=60 chars on a word boundary. Falls back to the cleaned ask when
 * stripping would leave fewer than two words.
 */
export function heuristicTitle(ask: string): string {
  const clean = heuristicCleanAsk(ask);
  const words = clean.split(/\s+/).filter(Boolean);

  let start = 0;
  while (start < words.length) {
    const w = words[start]
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/^[^a-z']+|[^a-z']+$/g, "");
    if (HEURISTIC_TITLE_FILLER.has(w)) start += 1;
    else break;
  }

  // Keep the original when nothing was stripped or too little survives.
  let kept = start > 0 && words.length - start >= 2 ? words.slice(start) : words;

  // Drop a single leading determiner left over after verb stripping.
  if (kept.length > 2 && /^(?:a|an|the|some)$/i.test(kept[0])) kept = kept.slice(1);

  let title = kept.join(" ");
  if (title.length > 60) {
    const cut = title.slice(0, 60);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[.;:,\s]+$/, "");
  }
  // Capitalise the first alphabetic character; leave the rest (SEO, Google…).
  return title.replace(/[a-z]/i, (c) => c.toUpperCase());
}

/** Parse a leading small count ("3 blog posts", "three pages") → quantity, else 1. */
export function heuristicQuantity(ask: string): number {
  const t = ask.trim();
  if (/^(?:a|an)\s+/i.test(t)) return 1;
  const digit = t.match(/^(\d{1,3})\b/);
  if (digit) {
    const n = Number(digit[1]);
    if (Number.isFinite(n) && n > 0 && n <= 999) return n;
  }
  const word = t.toLowerCase().match(/^([a-z]+)\b/);
  if (word && HEURISTIC_NUMBER_WORDS[word[1]]) return HEURISTIC_NUMBER_WORDS[word[1]];
  return 1;
}

/**
 * Split the brief into candidate asks: every bullet / numbered list item, plus
 * every prose sentence that contains an action verb. Returns { text, quote }
 * where `text` is cleaned for display and `quote` is the verbatim body substring
 * proving the ask (null only for the subject fallback). Deduped
 * case-insensitively, capped at 25. Always returns at least one candidate.
 */
export function extractHeuristicAsks(
  subject: string,
  body: string,
): Array<{ text: string; quote: string | null }> {
  const out: Array<{ text: string; quote: string | null }> = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    if (out.length >= 25) return;
    const quote = raw.replace(/\s+/g, " ").trim();
    const text = heuristicCleanAsk(raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""));
    if (text.length < 6 || text.length > 300) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text, quote: quote.slice(0, 2000) });
  };

  for (const rawLine of body.split(/\r?\n/)) {
    if (out.length >= 25) break;
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(rawLine)) {
      push(rawLine);
      continue;
    }
    // Prose line — keep sentences that read like an ask.
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s && HEURISTIC_ASK_VERB_RE.test(s)) push(s);
    }
  }

  // Fallback: nothing looked like an ask → use the subject (or a body slice) so
  // the caller never sees an empty extraction (which would 422).
  if (out.length === 0) {
    const subj = heuristicCleanAsk(subject);
    if (subj) out.push({ text: subj.slice(0, 120), quote: null });
    else {
      const slice = heuristicCleanAsk(body).slice(0, 120);
      if (slice) out.push({ text: slice, quote: heuristicCleanAsk(body).slice(0, 2000) });
    }
  }

  return out.slice(0, 25);
}

/** Best deliverable catalogue match for one ask, or null. Requires ≥2 shared
 *  significant tokens or a full service-name substring hit to avoid noise. */
function heuristicMatchService(
  ask: string,
  services: CatalogueService[],
): { service: CatalogueService; score: number } | null {
  const askTokens = new Set(heuristicTokens(ask));
  if (askTokens.size === 0) return null;
  const askNorm = ` ${heuristicNormalize(ask)} `;

  let best: { service: CatalogueService; score: number; ratio: number } | null = null;
  for (const svc of services) {
    // Mirror the LLM path: only real deliverable codes are matchable.
    if (svc.is_deliverable === false || !svc.code) continue;
    const nameTokens = new Set(heuristicTokens(svc.name));
    if (nameTokens.size === 0) continue;

    let shared = 0;
    for (const t of nameTokens) if (askTokens.has(t)) shared++;
    const nameNorm = heuristicNormalize(svc.name);
    const substring = nameNorm.length >= 4 && askNorm.includes(` ${nameNorm} `);
    if (shared < 2 && !substring) continue;

    const ratio = shared / nameTokens.size;
    const score = shared + (substring ? 5 : 0);
    if (!best || score > best.score || (score === best.score && ratio > best.ratio)) {
      best = { service: svc, score, ratio };
    }
  }
  return best ? { service: best.service, score: best.score } : null;
}

/**
 * Deterministic, no-AI equivalent of the analyze-mode extraction. Produces
 * insert-ready ParsedScopeItem rows from the brief text alone. Confidence is
 * always < 0.6 so resolveDisposition flags every row needs_review.
 */
// ---------------------------------------------------------------------------
// Team-task seeding — deterministic per-line ClickUp work breakdown.
//
// When a billable placement is matched to a service, its placement_tasks rows
// (the "Team tasks · scheduled in ClickUp" panel) are seeded from the service's
// own cost structure — its authored process_steps when present, otherwise its
// resolved department allocation. NO AI: this is pure catalogue data, so the
// breakdown always builds even with ANTHROPIC_API_KEY absent.
// ---------------------------------------------------------------------------

/** Sprint-point convention: 1 pt = 15 min → 4 pt/hr (mirrors src/lib/sprint-points.ts). */
export function pointsFromHours(hours: number): number {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.round(h * 4 * 100) / 100;
}

export type SeedProcessStep = {
  ordinal: number;
  title: string;
  department_id: string | null;
  estimated_hours: number | null;
};

export type SeedAllocation = {
  department_id: string;
  hours: number | null;
};

/** An insert-ready placement_tasks row (brief_id/placement_id filled by caller). */
export type SeedTaskRow = {
  brief_id: string;
  placement_id: string;
  title: string;
  department_id: string | null;
  hours: number;
  points: number;
  sort_order: number;
  ai_generated: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the team-task rows for one matched placement, deterministically:
 *  1. authored process_steps (ordered) → one task each, or
 *  2. resolved department allocation (hours > 0) → one task per department, or
 *  3. a single unestimated task so the line still carries a ClickUp task.
 * Hours scale by the ask quantity; points derive via pointsFromHours.
 */
export function buildSeedTasksForPlacement(opts: {
  placementId: string;
  briefId: string;
  quantity: number;
  steps: SeedProcessStep[];
  allocation: SeedAllocation[];
  serviceName: string;
}): SeedTaskRow[] {
  const qty = Number.isFinite(opts.quantity) && opts.quantity > 0 ? opts.quantity : 1;
  const name = (opts.serviceName || "Deliverable").slice(0, 200);

  // Authored process steps are used only when they carry real budgeted hours —
  // many services hold a single empty "New step" placeholder that would seed a
  // useless 0h task and hide the service's actual allocation. When steps have no
  // hours, fall through to the department allocation (which does).
  const steps = [...opts.steps].sort((a, b) => a.ordinal - b.ordinal);
  const stepsHours = steps.reduce((sum, s) => sum + (Number(s.estimated_hours) || 0), 0);
  if (steps.length > 0 && stepsHours > 0) {
    return steps.map((s, i) => {
      const hours = round2((Number(s.estimated_hours) || 0) * qty);
      return {
        brief_id: opts.briefId,
        placement_id: opts.placementId,
        title: (s.title?.trim() || name).slice(0, 200),
        department_id: s.department_id ?? null,
        hours,
        points: pointsFromHours(hours),
        sort_order: i,
        ai_generated: false,
      };
    });
  }

  const alloc = opts.allocation
    .filter((a) => (Number(a.hours) || 0) > 0)
    .sort((a, b) => (Number(b.hours) || 0) - (Number(a.hours) || 0));
  if (alloc.length > 0) {
    return alloc.map((a, i) => {
      const hours = round2((Number(a.hours) || 0) * qty);
      return {
        brief_id: opts.briefId,
        placement_id: opts.placementId,
        title: name,
        department_id: a.department_id,
        hours,
        points: pointsFromHours(hours),
        sort_order: i,
        ai_generated: false,
      };
    });
  }

  return [{
    brief_id: opts.briefId,
    placement_id: opts.placementId,
    title: name,
    department_id: null,
    hours: 0,
    points: 0,
    sort_order: 0,
    ai_generated: false,
  }];
}

export function heuristicScopeItems(opts: {
  subject: string;
  body: string;
  services: CatalogueService[];
  /** Selected SOW slugs — the sole slug groups matched items when there's one. */
  slugs: string[];
}): ParsedScopeItem[] {
  const deliverable = opts.services.filter((s) => s.is_deliverable !== false && !!s.code);
  const soleSlug = opts.slugs.length === 1 ? opts.slugs[0] : null;

  return extractHeuristicAsks(opts.subject, opts.body).map(({ text, quote }) => {
    const match = heuristicMatchService(text, deliverable);
    const service = match?.service ?? null;
    const confidence = match
      ? match.score >= 5 ? 0.55 : match.score >= 3 ? 0.5 : 0.45
      : 0.3;
    return {
      item_name: heuristicTitle(text),
      item_description: text,
      // Recomputed downstream from the deterministic disposition; value here is
      // never persisted directly.
      is_inside: false,
      sow_slug: service ? soleSlug : null,
      service_area_id: null,
      ai_confidence: confidence,
      ai_match_quote: service
        ? `Heuristic keyword match → ${service.code} ${service.name} (no AI; confirm)`
        : "No catalogue match found by keyword heuristic (no AI; confirm)",
      suggested_service_id: service?.id ?? null,
      estimated_cents: service?.sell_price_cents ?? null,
      matched_service_code: service?.code ?? null,
      quantity: heuristicQuantity(text),
      grounding_quote: quote,
      confidence,
    };
  });
}

// ---------------------------------------------------------------------------
// Intelligence-seeded extraction — for briefs created by the /intake skill.
//
// Intake already extracted requirements from the full email thread (with far
// more context than this function ever sees) and mapped them to catalogue
// services in brief_intelligence.requirements. When that data exists, placement
// items are built deterministically from it — NO AI call, NO keyword heuristic.
// resolveDisposition still assigns in/new/out downstream from the allowance
// ledger, exactly as for AI-extracted items.
// ---------------------------------------------------------------------------

/** One requirement row from brief_intelligence.requirements (intake Stage 2). */
export type IntelligenceRequirement = {
  text?: string;
  interpretation?: string;
  /** 'high' | 'medium' | 'low' from the intake pipeline. */
  confidence?: string;
  mapped_services?: Array<{ service_id: string; qty?: number }>;
  /** Backwards-compat flat shape (unique service ids, qty 1). */
  mapped_service_ids?: string[];
};

const REQ_CONFIDENCE: Record<string, number> = { high: 0.9, medium: 0.65, low: 0.4 };

/**
 * Pseudo catalogue code for services that have no Xero code. The disposition
 * resolver matches by code; keying codeless services as `id:<uuid>` lets an
 * intelligence-mapped service resolve instead of falling to out_of_scope.
 */
export function serviceCodeKey(svc: { id: string; code: string | null }): string {
  return svc.code ?? `id:${svc.id}`;
}

/**
 * Build insert-ready placement items from intake's pre-extracted requirements.
 * One item per (requirement × mapped service); a requirement with no mapped
 * service still yields one unmatched item so the ask stays visible on the
 * receipt (it will resolve to out_of_scope for the operator to triage).
 */
export function intelligenceScopeItems(opts: {
  requirements: IntelligenceRequirement[];
  services: CatalogueService[];
  /** Selected SOW slugs — the sole slug groups matched items when there's one. */
  slugs: string[];
}): ParsedScopeItem[] {
  const byId = new Map(opts.services.map((s) => [s.id, s]));
  const soleSlug = opts.slugs.length === 1 ? opts.slugs[0] : null;
  const items: ParsedScopeItem[] = [];

  for (const req of opts.requirements ?? []) {
    const ask = (req.interpretation || req.text || "").trim();
    if (!ask) continue;
    const confidence = REQ_CONFIDENCE[req.confidence ?? ""] ?? 0.65;

    const mapped: Array<{ service_id: string; qty?: number }> =
      Array.isArray(req.mapped_services) && req.mapped_services.length > 0
        ? req.mapped_services
        : (req.mapped_service_ids ?? []).map((service_id) => ({ service_id }));

    const resolved = mapped
      .map((m) => ({ svc: byId.get(m.service_id), qty: m.qty }))
      .filter((m): m is { svc: CatalogueService; qty: number | undefined } => !!m.svc);

    if (resolved.length === 0) {
      items.push({
        item_name: heuristicTitle(ask),
        item_description: req.text && req.interpretation ? req.text : "",
        is_inside: false,
        sow_slug: null,
        service_area_id: null,
        ai_confidence: Math.min(confidence, 0.4),
        ai_match_quote: "Intake requirement with no catalogue service mapped (no AI; confirm)",
        suggested_service_id: null,
        estimated_cents: null,
        matched_service_code: null,
        quantity: 1,
        grounding_quote: req.text ?? null,
        confidence: Math.min(confidence, 0.4),
      });
      continue;
    }

    for (const { svc, qty } of resolved) {
      const quantity = typeof qty === "number" && Number.isFinite(qty) && qty > 0 ? qty : 1;
      items.push({
        item_name: heuristicTitle(ask),
        item_description: req.text && req.interpretation ? req.text : "",
        is_inside: false,
        sow_slug: soleSlug,
        service_area_id: null,
        ai_confidence: confidence,
        ai_match_quote: `Mapped by intake intelligence → ${serviceCodeKey(svc)} ${svc.name}`,
        suggested_service_id: svc.id,
        estimated_cents: svc.sell_price_cents ?? null,
        matched_service_code: serviceCodeKey(svc),
        quantity,
        grounding_quote: req.text ?? null,
        confidence,
      });
    }
  }

  return items;
}
