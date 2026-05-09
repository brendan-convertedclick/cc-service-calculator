// Pure logic for the auto-scope edge function.
// No side effects, no external calls — fully testable.

export type IntentType =
  | "new_brief"
  | "project_thread"
  | "retainer_thread"
  | "general_query"
  | "quick_response";

const VALID_INTENT_TYPES = new Set<string>([
  "new_brief",
  "project_thread",
  "retainer_thread",
  "general_query",
  "quick_response",
]);

/**
 * Extract bullet-list items from a markdown config file.
 * Handles `- item` and `* item` syntax; ignores headers and blank lines.
 */
export function parseQuickResponseRules(md: string): string[] {
  return md
    .split("\n")
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true if the email subject or body contains any rule keyword (case-insensitive).
 */
export function matchesQuickResponseRule(
  subject: string,
  body: string,
  rules: string[],
): boolean {
  if (rules.length === 0) return false;
  const haystack = `${subject} ${body}`.toLowerCase();
  return rules.some((rule) => haystack.includes(rule));
}

/**
 * Parse Claude's classify call response. Returns 'new_brief' as a safe fallback.
 */
export function parseClassifyResponse(text: string): IntentType {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return "new_brief";
    const parsed = JSON.parse(match[0]);
    const t = parsed?.intent_type;
    return typeof t === "string" && VALID_INTENT_TYPES.has(t) ? (t as IntentType) : "new_brief";
  } catch {
    return "new_brief";
  }
}

/**
 * Extract JSON from Claude's scope/respond call. Returns empty object on failure.
 */
export function parseScopeJson(text: string): Record<string, unknown> {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Prompt builders — return { system, userContent } pairs for callAnthropic
// ---------------------------------------------------------------------------

export const CLASSIFY_SYSTEM = [
  "You are an agency intake classifier at Converted Click, a digital marketing agency.",
  "Given an email and optional client context, classify the request intent.",
  "Return JSON only: {\"intent_type\":\"<type>\",\"reasoning\":\"<one sentence>\"}",
  "Types:",
  "  new_brief       — new work request, no existing project or retainer mentioned",
  "  project_thread  — references an active project by name or description",
  "  retainer_thread — relates to an ongoing retainer engagement",
  "  general_query   — advisory or planning question, no deliverable requested",
  "  quick_response  — simple logistics (reschedule, acknowledgement) — no scoping needed",
  "When in doubt, use new_brief.",
].join("\n");

export function buildClassifyUser(opts: {
  subject: string;
  body: string;
  clientName: string | null;
  wikiContext: string;
}): string {
  const parts = [
    opts.clientName ? `Client: ${opts.clientName}` : null,
    `Subject: ${opts.subject}`,
    "",
    "Body:",
    opts.body,
    opts.wikiContext ? `\n${opts.wikiContext}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}

const SCOPE_SYSTEM_BASE =
  "You are a digital agency scoping analyst at Converted Click. " +
  "Analyse the client email and return JSON only. Do not invent commitments.";

const SCOPE_INSTRUCTIONS: Record<Exclude<IntentType, "quick_response">, string> = {
  new_brief: [
    'Return: {"enhanced_prose":"<one-paragraph clarified summary>",',
    '"in_scope":["<explicit in-scope items>"],',
    '"out_of_scope":["<likely excluded items to confirm>"],',
    '"open_questions":["<questions to ask before quoting>"]}',
  ].join("\n"),
  project_thread: [
    'Return: {"enhanced_prose":"<summary of the change request>",',
    '"in_scope":["<already covered by existing project scope>"],',
    '"out_of_scope":["<items that would require scope addition>"],',
    '"open_questions":["<questions to clarify before estimating the addition>"]}',
  ].join("\n"),
  retainer_thread: [
    'Return: {"enhanced_prose":"<summary of the request in retainer context>",',
    '"in_scope":["<covered under current retainer>"],',
    '"out_of_scope":["<would exceed retainer or need separate engagement>"],',
    '"open_questions":["<capacity or timeline questions>"]}',
  ].join("\n"),
  general_query: [
    'Return: {"enhanced_prose":"<summary of what they are asking about>",',
    '"in_scope":["<key topics to address in response>"],',
    '"out_of_scope":[],',
    '"open_questions":["<any clarifications needed before responding>"]}',
  ].join("\n"),
};

const QUICK_RESPONSE_INSTRUCTIONS = [
  'Return: {"draft_reply":"<warm, professional one-paragraph reply>"}',
  "The reply should acknowledge the request and confirm next steps.",
].join("\n");

export function buildScopeSystem(intentType: IntentType): string {
  if (intentType === "quick_response") {
    return `${SCOPE_SYSTEM_BASE}\n${QUICK_RESPONSE_INSTRUCTIONS}`;
  }
  return `${SCOPE_SYSTEM_BASE}\n${SCOPE_INSTRUCTIONS[intentType]}`;
}

export function buildScopeUser(opts: {
  subject: string;
  body: string;
  clientName: string | null;
  wikiContext: string;
}): string {
  const parts = [
    opts.clientName ? `Client: ${opts.clientName}` : null,
    `Subject: ${opts.subject}`,
    "",
    "Body:",
    opts.body,
    opts.wikiContext ? `\n${opts.wikiContext}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}
