# Auto-Scope on Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-classify and pre-scope every new brief at relay time so the team opens the Inbox to find briefs already understood — just needing human tailoring.

**Architecture:** `gmail-relay` fires a background `fetch()` to a new `auto-scope` Edge Function using `EdgeRuntime.waitUntil()` immediately after inserting a new brief. `auto-scope` runs a rule pre-filter for quick responses, then two Claude calls (classify + scope), and writes results back to `briefs` and `scopes`. Failure in `auto-scope` never affects relay delivery.

**Tech Stack:** Deno Edge Functions, Anthropic claude-sonnet-4-6, Supabase Postgres, GitHub Contents API (existing wiki-context helper), React + shadcn/ui

---

## File Map

| Action | Path |
|---|---|
| Create | `supabase/migrations/0029_auto_scope_intent.sql` |
| Create | `wiki/config/quick-response-rules.md` (CC-Vault repo) |
| Modify | `supabase/functions/_shared/wiki-context.ts` (add `loadWikiFile`) |
| Create | `supabase/functions/_shared/auto-scope-logic.ts` |
| Create | `supabase/functions/_shared/auto-scope-logic.test.ts` |
| Create | `supabase/functions/auto-scope/index.ts` |
| Modify | `supabase/functions/gmail-relay/index.ts` (fire-and-forget) |
| Modify | `src/types/db.ts` (regenerated) |
| Modify | `src/components/BriefList.tsx` (intent_type badge) |
| Modify | `src/components/BriefConversation.tsx` (pending state + draft_reply box + intent badge) |

---

## Task 1: Migration — add `intent_type`, `draft_reply`, `scope_type`

**Files:**
- Create: `supabase/migrations/0029_auto_scope_intent.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0029_auto_scope_intent.sql
ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS intent_type text
    CHECK (intent_type IN (
      'new_brief','project_thread','retainer_thread','general_query','quick_response'
    )),
  ADD COLUMN IF NOT EXISTS draft_reply text;

COMMENT ON COLUMN public.briefs.intent_type IS
  'AI-classified request type, set by auto-scope on ingest. NULL until auto-scope completes.';
COMMENT ON COLUMN public.briefs.draft_reply IS
  'AI-drafted reply text. Populated only for quick_response intent_type.';

ALTER TABLE public.scopes
  ADD COLUMN IF NOT EXISTS scope_type text
    CHECK (scope_type IN (
      'new_brief','project_thread','retainer_thread','general_query'
    ));

COMMENT ON COLUMN public.scopes.scope_type IS
  'Mirrors brief intent_type. Tells the UI which label set to use when rendering scope fields.';
```

- [ ] **Step 2: Apply the migration**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
supabase db push
```

Expected: migration applies cleanly, no errors. Both new columns appear in `briefs` and `scopes`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0029_auto_scope_intent.sql
git commit -m "feat(db): add intent_type, draft_reply to briefs and scope_type to scopes"
```

---

## Task 2: Create quick-response rules config file

**Files:**
- Create: `/Users/brendangunn/Github/CC-Vault/cc-vault/wiki/config/quick-response-rules.md`

- [ ] **Step 1: Create the file**

```markdown
---
type: config
title: Quick Response Rules
updated: 2026-05-09
context: hidden
---

# Quick Response Rules

Each rule below causes an email to be classified as `quick_response` automatically,
skipping the AI classify call. The rule engine checks subject and body (case-insensitive).
Add new rules as bullet items — one keyword or phrase per line.

## Subject keyword rules

- reschedule
- rescheduling
- change of meeting
- move our call
- cancel our meeting

## Short-body keyword rules (subject match + body under 80 words)

- following up
- just checking in
- received your
- quick question
```

Note: `context: hidden` prevents this config file from being included in client AI context blocks.

- [ ] **Step 2: Commit in CC-Vault**

```bash
cd /Users/brendangunn/Github/CC-Vault
git add cc-vault/wiki/config/quick-response-rules.md
git commit -m "feat: add quick-response-rules config for auto-scope"
git push
```

Expected: file appears on GitHub main branch. `auto-scope` will fetch it at runtime via the GitHub Contents API.

---

## Task 3: Add `loadWikiFile` to `_shared/wiki-context.ts`

**Files:**
- Modify: `supabase/functions/_shared/wiki-context.ts`

The existing `fetchRaw` function is private. Export a `loadWikiFile` helper that fetches a single file by path, returning empty string on 404 or error (same best-effort pattern as the rest of wiki-context).

- [ ] **Step 1: Add the export**

Append to the bottom of `supabase/functions/_shared/wiki-context.ts`:

```typescript
/**
 * Fetch a single markdown file from a GitHub repo by path.
 * Returns empty string on 404 or any error — never throws.
 */
export async function loadWikiFile(opts: {
  path: string;
  repo: string;
  pat: string;
}): Promise<string> {
  const { path, repo, pat } = opts;
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=main`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) return "";
    if (!res.ok) {
      console.warn(`[wiki-context] loadWikiFile ${res.status} for ${path}`);
      return "";
    }
    const meta = await res.json() as { download_url?: string };
    if (!meta.download_url) return "";
    const raw = await fetch(meta.download_url, {
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (!raw.ok) return "";
    return await raw.text();
  } catch (e) {
    console.warn(`[wiki-context] loadWikiFile failed for ${path}: ${e}`);
    return "";
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/wiki-context.ts
git commit -m "feat(shared): export loadWikiFile for single-file GitHub fetch"
```

---

## Task 4: `_shared/auto-scope-logic.ts` — pure functions + tests

**Files:**
- Create: `supabase/functions/_shared/auto-scope-logic.ts`
- Create: `supabase/functions/_shared/auto-scope-logic.test.ts`

Extract all testable pure logic — rule parsing, rule matching, response parsing, prompt building — into a shared module. `auto-scope/index.ts` will be thin orchestration on top.

- [ ] **Step 1: Write the failing tests first**

Create `supabase/functions/_shared/auto-scope-logic.test.ts`:

```typescript
// Run with: deno test supabase/functions/_shared/auto-scope-logic.test.ts
import { assertEquals } from "jsr:@std/assert";
import {
  parseQuickResponseRules,
  matchesQuickResponseRule,
  parseClassifyResponse,
  parseScopeJson,
} from "./auto-scope-logic.ts";

// --- parseQuickResponseRules ---

Deno.test("parseQuickResponseRules: extracts bullet items from markdown", () => {
  const md = `# Config\n\n## Subject rules\n\n- reschedule\n- rescheduling\n\n## Other\n\n- following up\n`;
  const rules = parseQuickResponseRules(md);
  assertEquals(rules, ["reschedule", "rescheduling", "following up"]);
});

Deno.test("parseQuickResponseRules: returns empty array for empty string", () => {
  assertEquals(parseQuickResponseRules(""), []);
});

Deno.test("parseQuickResponseRules: trims whitespace from rules", () => {
  const md = `-  reschedule  \n-  rescheduling  `;
  const rules = parseQuickResponseRules(md);
  assertEquals(rules, ["reschedule", "rescheduling"]);
});

// --- matchesQuickResponseRule ---

Deno.test("matchesQuickResponseRule: matches keyword in subject (case-insensitive)", () => {
  const rules = ["reschedule"];
  assertEquals(matchesQuickResponseRule("Can we Reschedule?", "body text", rules), true);
});

Deno.test("matchesQuickResponseRule: matches keyword in body", () => {
  const rules = ["following up"];
  assertEquals(matchesQuickResponseRule("Hello", "Just following up on our call", rules), true);
});

Deno.test("matchesQuickResponseRule: no match returns false", () => {
  const rules = ["reschedule"];
  assertEquals(matchesQuickResponseRule("New website project", "Please see attached brief", rules), false);
});

Deno.test("matchesQuickResponseRule: empty rules returns false", () => {
  assertEquals(matchesQuickResponseRule("Reschedule", "body", []), false);
});

// --- parseClassifyResponse ---

Deno.test("parseClassifyResponse: extracts intent_type from JSON", () => {
  const text = `{"intent_type":"new_brief","reasoning":"Client is requesting a new website"}`;
  assertEquals(parseClassifyResponse(text), "new_brief");
});

Deno.test("parseClassifyResponse: handles JSON embedded in prose", () => {
  const text = `Here is the result:\n{"intent_type":"project_thread","reasoning":"References current project"}`;
  assertEquals(parseClassifyResponse(text), "project_thread");
});

Deno.test("parseClassifyResponse: returns new_brief as fallback on invalid JSON", () => {
  assertEquals(parseClassifyResponse("not json at all"), "new_brief");
});

Deno.test("parseClassifyResponse: returns new_brief when intent_type is unrecognised", () => {
  const text = `{"intent_type":"unknown_type","reasoning":"..."}`;
  assertEquals(parseClassifyResponse(text), "new_brief");
});

// --- parseScopeJson ---

Deno.test("parseScopeJson: parses standard scope response", () => {
  const text = `{"enhanced_prose":"Summary","in_scope":["Item A"],"out_of_scope":[],"open_questions":["Q1"]}`;
  const result = parseScopeJson(text);
  assertEquals(result.enhanced_prose, "Summary");
  assertEquals(result.in_scope, ["Item A"]);
  assertEquals(result.open_questions, ["Q1"]);
});

Deno.test("parseScopeJson: parses quick_response draft_reply", () => {
  const text = `{"draft_reply":"Thank you for reaching out, we will be in touch shortly."}`;
  const result = parseScopeJson(text);
  assertEquals(result.draft_reply, "Thank you for reaching out, we will be in touch shortly.");
});

Deno.test("parseScopeJson: returns empty object on invalid JSON", () => {
  const result = parseScopeJson("not json");
  assertEquals(Object.keys(result).length, 0);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
deno test supabase/functions/_shared/auto-scope-logic.test.ts
```

Expected: error `Cannot resolve module './auto-scope-logic.ts'`. If you see a different error, fix it before continuing.

- [ ] **Step 3: Implement `_shared/auto-scope-logic.ts`**

Create `supabase/functions/_shared/auto-scope-logic.ts`:

```typescript
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
    const match = text.match(/\{[\s\S]*?\}/);
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
deno test supabase/functions/_shared/auto-scope-logic.test.ts
```

Expected output:
```
running 12 tests from ./supabase/functions/_shared/auto-scope-logic.test.ts
parseQuickResponseRules: extracts bullet items from markdown ... ok
parseQuickResponseRules: returns empty array for empty string ... ok
parseQuickResponseRules: trims whitespace from rules ... ok
matchesQuickResponseRule: matches keyword in subject (case-insensitive) ... ok
matchesQuickResponseRule: matches keyword in body ... ok
matchesQuickResponseRule: no match returns false ... ok
matchesQuickResponseRule: empty rules returns false ... ok
parseClassifyResponse: extracts intent_type from JSON ... ok
parseClassifyResponse: handles JSON embedded in prose ... ok
parseClassifyResponse: returns new_brief as fallback on invalid JSON ... ok
parseClassifyResponse: returns new_brief when intent_type is unrecognised ... ok
parseScopeJson: parses standard scope response ... ok
parseScopeJson: parses quick_response draft_reply ... ok
parseScopeJson: returns empty object on invalid JSON ... ok

ok | 14 passed | 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/auto-scope-logic.ts \
        supabase/functions/_shared/auto-scope-logic.test.ts
git commit -m "feat(shared): auto-scope-logic — rule parsing, classify/scope response parsing, prompt builders"
```

---

## Task 5: `supabase/functions/auto-scope/index.ts`

**Files:**
- Create: `supabase/functions/auto-scope/index.ts`

Thin orchestration layer. Calls wiki-context helpers, then the pure functions from auto-scope-logic, then callAnthropic, then writes to DB.

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/auto-scope/index.ts
//
// Request:  POST { brief_id: string }
//   Authorization: Bearer <service_role_key>  (called internally by gmail-relay)
// Response: 200 { ok: true, intent_type: string }
//   - 404 if brief not found
//   - 500 on unexpected error (brief is never affected)
//
// Failure in this function is always logged and swallowed — it must never
// cause gmail-relay to fail or retry.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";
import { loadClientWikiContext, loadWikiFile } from "../_shared/wiki-context.ts";
import {
  type IntentType,
  parseQuickResponseRules,
  matchesQuickResponseRule,
  parseClassifyResponse,
  parseScopeJson,
  CLASSIFY_SYSTEM,
  buildClassifyUser,
  buildScopeSystem,
  buildScopeUser,
} from "../_shared/auto-scope-logic.ts";

const WIKI_REPO = Deno.env.get("WIKI_GITHUB_REPO") ?? "";
const WIKI_PAT  = Deno.env.get("WIKI_GITHUB_PAT")  ?? "";
const RULES_PATH = "cc-vault/wiki/config/quick-response-rules.md";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { brief_id } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createServiceRoleClient();

    // 1. Load brief + client
    const { data: brief, error: bErr } = await supabase
      .from("briefs")
      .select("*, client:clients(id, name, wiki_path)")
      .eq("id", brief_id)
      .single();

    if (bErr || !brief) {
      console.error(`[auto-scope] brief ${brief_id} not found`, bErr?.message);
      return json({ error: "not found" }, 404);
    }

    const client = (brief as { client?: { id: string; name: string; wiki_path: string | null } | null }).client;

    const [{ data: settings }] = await Promise.all([
      supabase.from("settings").select("anthropic_model").eq("id", 1).single(),
    ]);
    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";

    // 2. Load wiki context (best-effort — never throws)
    let wikiContext = "";
    let rulesMarkdown = "";

    if (WIKI_REPO && WIKI_PAT) {
      const [wikiResult, rulesResult] = await Promise.allSettled([
        client?.wiki_path
          ? loadClientWikiContext({
              clientName: client.name,
              wikiPath: client.wiki_path,
              repo: WIKI_REPO,
              pat: WIKI_PAT,
            })
          : Promise.resolve(""),
        loadWikiFile({ path: RULES_PATH, repo: WIKI_REPO, pat: WIKI_PAT }),
      ]);
      if (wikiResult.status === "fulfilled") wikiContext = wikiResult.value;
      if (rulesResult.status === "fulfilled") rulesMarkdown = rulesResult.value;
    }

    const subject = brief.raw_subject ?? "";
    const body = brief.raw_body ?? "";
    const clientName = client?.name ?? null;

    // 3. Rule pre-filter
    const rules = parseQuickResponseRules(rulesMarkdown);
    let intentType: IntentType;

    if (matchesQuickResponseRule(subject, body, rules)) {
      intentType = "quick_response";
    } else {
      // 4. Claude call 1 — classify
      try {
        const classifyBody = await callAnthropic({
          model,
          system: CLASSIFY_SYSTEM,
          messages: [{ role: "user", content: buildClassifyUser({ subject, body, clientName, wikiContext }) }],
          maxTokens: 256,
          cacheSystem: true,
        });
        const classifyText: string = classifyBody.content?.[0]?.text ?? "";
        intentType = parseClassifyResponse(classifyText);
      } catch (e) {
        console.error("[auto-scope] classify call failed:", e);
        // Leave intent_type null — UI shows pending state with manual fallback
        await supabase
          .from("briefs")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", brief_id);
        return json({ ok: false, error: "classify failed" }, 200);
      }
    }

    // 5. Claude call 2 — scope / respond
    let scopeData: Record<string, unknown> = {};
    try {
      const scopeBody = await callAnthropic({
        model,
        system: buildScopeSystem(intentType),
        messages: [{ role: "user", content: buildScopeUser({ subject, body, clientName, wikiContext }) }],
        maxTokens: 2048,
        cacheSystem: true,
      });
      const scopeText: string = scopeBody.content?.[0]?.text ?? "";
      scopeData = parseScopeJson(scopeText);
    } catch (e) {
      console.error("[auto-scope] scope call failed:", e);
      // Still write intent_type — the scope can be filled manually
    }

    // 6. Write to DB
    await supabase
      .from("briefs")
      .update({
        intent_type: intentType,
        draft_reply: intentType === "quick_response"
          ? (typeof scopeData.draft_reply === "string" ? scopeData.draft_reply : null)
          : null,
        status: "needs_review",
        updated_at: new Date().toISOString(),
      })
      .eq("id", brief_id);

    if (intentType !== "quick_response") {
      const toStrings = (v: unknown): string[] =>
        Array.isArray(v) ? (v as unknown[]).map(String) : [];

      await supabase
        .from("scopes")
        .upsert(
          {
            brief_id,
            scope_type: intentType,
            enhanced_prose: typeof scopeData.enhanced_prose === "string"
              ? scopeData.enhanced_prose
              : null,
            in_scope_md: toStrings(scopeData.in_scope).map((s) => `- ${s}`).join("\n") || null,
            out_of_scope_md: toStrings(scopeData.out_of_scope).map((s) => `- ${s}`).join("\n") || null,
            open_questions_md: toStrings(scopeData.open_questions).map((s) => `- ${s}`).join("\n") || null,
            ai_drafted: true,
            ai_context_snapshot: wikiContext || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "brief_id" },
        );
    }

    return json({ ok: true, intent_type: intentType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auto-scope] unhandled error:", msg);
    return json({ error: msg }, 500);
  }
});
```

- [ ] **Step 2: Deploy the function**

```bash
supabase functions deploy auto-scope --no-verify-jwt
```

Expected: `Deployed auto-scope`. The `--no-verify-jwt` flag is required because `auto-scope` is called with the service role key directly (not a user JWT).

- [ ] **Step 3: Smoke test with curl**

Replace `<SUPABASE_URL>`, `<SERVICE_ROLE_KEY>`, and `<REAL_BRIEF_ID>` with values from your local `.env.local`:

```bash
curl -X POST \
  "<SUPABASE_URL>/functions/v1/auto-scope" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"brief_id":"<REAL_BRIEF_ID>"}'
```

Expected: `{"ok":true,"intent_type":"new_brief"}` (or whichever type Claude infers).
Check the brief row in Supabase — `intent_type` should be set, `status` = `needs_review`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/auto-scope/index.ts
git commit -m "feat(edge): auto-scope — classify and pre-scope briefs on ingest"
```

---

## Task 6: Wire fire-and-forget in `gmail-relay`

**Files:**
- Modify: `supabase/functions/gmail-relay/index.ts`

Two changes: add `ctx` second argument to `Deno.serve`, and fire the background fetch after the new brief insert.

- [ ] **Step 1: Update `Deno.serve` signature**

In `gmail-relay/index.ts`, find line 72:
```typescript
Deno.serve(async (req: Request) => {
```
Change to:
```typescript
Deno.serve(async (req: Request, ctx) => {
```

- [ ] **Step 2: Add fire-and-forget after new brief insert**

Find the `!existing` block that ends with:
```typescript
      if (insertErr || !created) return json({ error: insertErr?.message ?? "Insert failed" }, 500);
      briefId = created.id;
    }
```

Immediately after `briefId = created.id;`, before the closing `}`, add:

```typescript
      // Fire-and-forget: auto-scope runs in background, relay returns immediately.
      const autoScopeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/auto-scope`;
      ctx.waitUntil(
        fetch(autoScopeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ brief_id: briefId }),
        }).catch((e) => console.error("[gmail-relay] auto-scope fire failed", e)),
      );
```

The full `!existing` block should now read:
```typescript
    } else {
      const first = body.messages[0];
      const { data: created, error: insertErr } = await supabase
        .from("briefs")
        .insert({
          client_id: clientId,
          source: "gmail_relay",
          status: "new",
          raw_subject: body.thread_subject,
          raw_body: first.body_text,
          sender_email: first.from.email,
          gmail_thread_id: body.thread_id,
        })
        .select("id")
        .single();
      if (insertErr || !created) return json({ error: insertErr?.message ?? "Insert failed" }, 500);
      briefId = created.id;

      // Fire-and-forget: auto-scope runs in background, relay returns immediately.
      const autoScopeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/auto-scope`;
      ctx.waitUntil(
        fetch(autoScopeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ brief_id: briefId }),
        }).catch((e) => console.error("[gmail-relay] auto-scope fire failed", e)),
      );
    }
```

- [ ] **Step 3: Deploy gmail-relay**

```bash
supabase functions deploy gmail-relay
```

Expected: `Deployed gmail-relay`. No change to response shape — relay still returns `{ brief_id, inserted_message_count }`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/gmail-relay/index.ts
git commit -m "feat(edge): gmail-relay fires auto-scope in background on new brief insert"
```

---

## Task 7: Regenerate DB types + intent badge in `BriefList`

**Files:**
- Modify: `src/types/db.ts` (regenerated)
- Modify: `src/components/BriefList.tsx`

- [ ] **Step 1: Regenerate types**

```bash
supabase gen types typescript --local > src/types/db.ts
```

Verify `intent_type` and `draft_reply` appear in the `briefs` Row/Insert/Update types, and `scope_type` in `scopes`.

- [ ] **Step 2: Add intent_type badge to BriefList**

Define a colour map and add the badge next to the status badge. In `src/components/BriefList.tsx`:

After the imports block, add:

```typescript
type IntentType = "new_brief" | "project_thread" | "retainer_thread" | "general_query" | "quick_response";

const INTENT_LABEL: Record<IntentType, string> = {
  new_brief: "NEW",
  project_thread: "PROJECT",
  retainer_thread: "RETAINER",
  general_query: "QUERY",
  quick_response: "QUICK",
};

const INTENT_CLASS: Record<IntentType, string> = {
  new_brief: "bg-blue-100 text-blue-800",
  project_thread: "bg-purple-100 text-purple-800",
  retainer_thread: "bg-orange-100 text-orange-800",
  general_query: "bg-gray-100 text-gray-700",
  quick_response: "bg-green-100 text-green-800",
};

function IntentBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-label-small text-gray-400">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300" />
        pending
      </span>
    );
  }
  const cls = INTENT_CLASS[type as IntentType] ?? "bg-gray-100 text-gray-700";
  const label = INTENT_LABEL[type as IntentType] ?? type;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-small font-medium ${cls}`}>
      {label}
    </span>
  );
}
```

Then in the `CardContent` JSX, replace:
```tsx
              <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>
```
with:
```tsx
              <div className="flex flex-shrink-0 items-center gap-2">
                <IntentBadge type={b.intent_type ?? null} />
                <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>
              </div>
```

- [ ] **Step 3: Verify the UI compiles**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/db.ts src/components/BriefList.tsx
git commit -m "feat(ui): intent_type badge on BriefList rows with pending spinner"
```

---

## Task 8: `BriefConversation` — pending state, intent badge, quick_response draft box

**Files:**
- Modify: `src/components/BriefConversation.tsx`

Three additions to the sheet:
1. Intent type badge in the header (alongside sender badge)
2. `intent_type === null` → subtle "Scope pending…" note in the header meta row
3. `intent_type === 'quick_response'` → highlighted `draft_reply` box above messages

- [ ] **Step 1: Add imports and helper**

At the top of `src/components/BriefConversation.tsx`, add `Copy` to the lucide import:
```typescript
import { X, Copy } from "lucide-react";
```

After the `type Brief = ...` line, add:

```typescript
const INTENT_LABEL: Record<string, string> = {
  new_brief: "New brief",
  project_thread: "Project thread",
  retainer_thread: "Retainer",
  general_query: "General query",
  quick_response: "Quick response",
};
```

- [ ] **Step 2: Add intent badge to header meta row**

In the `SheetHeader`, find the `<div className="flex flex-wrap items-center gap-2 mt-1">` that contains the sender badge and AssigneePicker. Add the intent badge at the start:

```tsx
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {brief.intent_type ? (
              <Badge className="text-label-small">
                {INTENT_LABEL[brief.intent_type] ?? brief.intent_type}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-label-small text-muted-foreground">
                Scope pending…
              </Badge>
            )}
            {brief.sender_email && (
              <Badge variant="secondary" className="text-label-small">
                {brief.sender_email}
              </Badge>
            )}
            <AssigneePicker briefId={brief.id} assigneeId={brief.assignee_id ?? null} />
            {downstreamChip}
          </div>
```

- [ ] **Step 3: Add quick_response draft box**

In the scrollable messages area, before the `{isLoading && ...}` block, add:

```tsx
        {brief.intent_type === "quick_response" && brief.draft_reply && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-label-small font-medium text-green-800">Draft reply</span>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-2 py-0.5 text-label-small text-green-700 hover:bg-green-100"
                onClick={() => {
                  navigator.clipboard.writeText(brief.draft_reply!);
                  toast.success("Copied to clipboard");
                }}
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
            </div>
            <p className="whitespace-pre-wrap text-body-small text-green-900">
              {brief.draft_reply}
            </p>
          </div>
        )}
```

- [ ] **Step 4: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 5: Start dev server and verify in browser**

```bash
npm run dev
```

Open `http://localhost:5174/inbox`. Confirm:
- Rows show intent badge (or "pending" spinner for existing briefs without intent_type)
- Opening a brief with `intent_type = 'quick_response'` shows the green draft box with Copy button
- Opening a brief with `intent_type = null` shows "Scope pending…" outline badge in header

- [ ] **Step 6: Commit**

```bash
git add src/components/BriefConversation.tsx
git commit -m "feat(ui): BriefConversation intent badge, pending state, quick_response draft box"
```

---

## Task 9: End-to-end smoke test

- [ ] **Step 1: Send a test email through Apps Script**

1. In your Gmail, label an email `→Inbox/Push`
2. In Apps Script editor, run `forceSync()`
3. Confirm `gmail-relay` Edge Function logs show: `[gmail-relay] auto-scope fire succeeded` (or no fire error)

- [ ] **Step 2: Verify auto-scope ran**

In Supabase Studio, open the `briefs` table. The new brief should have:
- `intent_type` set (not null) — within ~30 seconds of the relay
- `status` = `needs_review`
- `draft_reply` set if it was a quick-response type

If `intent_type` is still null after 60 seconds, check Edge Function logs for `[auto-scope]` errors.

- [ ] **Step 3: Verify in the Inbox UI**

Open `http://localhost:5174/inbox`. The new brief should show its intent badge immediately (or update within a few seconds via Realtime). Open the conversation sheet — confirm scope data or draft box appears correctly for the classified type.

- [ ] **Step 4: Test a quick-response rule match**

Send an email with subject "Can we reschedule our call?". After relay + auto-scope:
- `intent_type` = `quick_response`
- `draft_reply` contains a draft reply
- Conversation sheet shows the green draft box

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| D1: gmail-relay fires auto-scope fire-and-forget | Task 6 |
| D2: Rule pre-filter for quick_response | Task 4 (matchesQuickResponseRule) |
| D3: Rules in wiki config file | Task 2 |
| D4: Classify call → intent_type | Task 5 (Step 1, classify block) |
| D5: Scope call varies by intent_type | Task 5 (Step 1, scope block) + Task 4 (buildScopeSystem) |
| D6: intent_type + draft_reply on briefs | Task 1 (migration) |
| D7: scope_type on scopes | Task 1 (migration) |
| D8: intent badge on BriefList | Task 7 |
| D9: Pending state in BriefConversation | Task 8 |
| D10: quick_response draft box | Task 8 |
| D11: Failure swallowed, brief unaffected | Task 5 (error handling blocks) |
| D12: loadWikiFile for rules config | Task 3 |

All spec requirements covered.
