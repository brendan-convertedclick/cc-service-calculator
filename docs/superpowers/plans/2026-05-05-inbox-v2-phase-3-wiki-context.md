# Inbox v2 — Phase 3: Wiki context for AI scoping — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Phases 1 + 2 shipped and signed off. Brendan has completed the out-of-band tasks listed below.

**Goal:** Inject the per-client Obsidian wiki content (markdown notes under `wiki/clients/<slug>/`) into the `draft-scope` Anthropic prompt so AI-drafted scopes incorporate brand, decision, and brief-format conventions captured in the wiki. Auto-provision a starter wiki folder when a new client is created.

**Architecture:** A new `loadClientWikiContext(client)` shared helper fetches the client's wiki folder from a private GitHub repo via the Contents API, walks `.md` files, parses frontmatter to honour `context: hidden`, and concatenates the surviving notes into a single `<client_context>` XML block. `draft-scope` calls the helper, prepends the block to the user prompt, and snapshots the rendered block to `scopes.ai_context_snapshot` so the prompt that produced any given scope is reproducible. A second new Edge Function `provision-client-wiki` is fired-and-forget from `useCreateClient` to write a starter `index.md` into the wiki repo when a client is created.

**Tech Stack:** Supabase Edge Functions (Deno), GitHub Contents API, Anthropic Messages API. New deps: none on the client; helper uses Deno standard library YAML parser for frontmatter.

**Spec reference:** [docs/superpowers/specs/2026-05-05-inbox-v2-and-wiki-context-design.md](../specs/2026-05-05-inbox-v2-and-wiki-context-design.md) — Phase 3.

---

## Brendan's out-of-band prerequisites (do BEFORE Task 1)

- [ ] **P1: Push the local CC-Vault repo to a private GitHub repo.** Recommended path: `convertedclick/cc-vault`.

- [ ] **P2: Create a fine-grained PAT scoped to that repo only.** Permissions: **Contents: Read and Write**. Expiration: 1 year (calendar reminder for rotation).

- [ ] **P3: Set Supabase secrets for both edge functions.**

  Run from a shell with `SUPABASE_ACCESS_TOKEN_CC_CALCULATOR` exported (per CLAUDE.md):

  ```bash
  npx supabase secrets set --project-ref lpgwxacoqiqpcfpkklib \
    WIKI_GITHUB_PAT=ghp_xxx_or_github_pat_xxx \
    WIKI_GITHUB_REPO=convertedclick/cc-vault \
    WIKI_GITHUB_BRANCH=main
  ```

  Or via the dashboard: Edge Functions → Manage secrets.

- [ ] **P4: Verify the wiki repo has a `wiki/clients/` directory and at least one populated client folder** (e.g. `wiki/clients/Kings-College/`) — Task 9's manual test relies on it.

These are gating conditions. Do not start Task 1 until all four are checked off.

---

## File Structure

**Migration**
- Create: `supabase/migrations/0025_clients_wiki_path.sql`

**Types**
- Regenerate: `src/types/db.ts`

**Edge functions**
- Create: `supabase/functions/_shared/wiki-context.ts`
- Create: `supabase/functions/_shared/wiki-context.test.ts`
- Create: `supabase/functions/_shared/frontmatter.ts`
- Create: `supabase/functions/_shared/frontmatter.test.ts`
- Create: `supabase/functions/provision-client-wiki/index.ts`
- Modify: `supabase/functions/draft-scope/index.ts`
- Modify: `supabase/config.toml` — register `provision-client-wiki` with `verify_jwt = false`

**Hooks**
- Modify: `src/hooks/useClients.ts` — `useCreateClient` fires `provision-client-wiki` after insert (fire-and-forget)

**Pages**
- Modify: `src/pages/Clients.tsx` — add a `Wiki path` column to the clients table

---

## Task 1: Migration — `0025_clients_wiki_path.sql`

**Files:**
- Create: `supabase/migrations/0025_clients_wiki_path.sql`
- Regenerate: `src/types/db.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0025_clients_wiki_path.sql`:

```sql
-- 0025_clients_wiki_path.sql
-- Apply via mcp__cc-supabase__apply_migration (name: clients_wiki_path)
-- Phase 3 of Inbox v2: per-client wiki path + AI context snapshot.

alter table public.clients add column wiki_path text;

-- Backfill from name with the same slugifier provision-client-wiki uses.
update public.clients
   set wiki_path = 'wiki/clients/' || regexp_replace(name, '[^A-Za-z0-9]+', '-', 'g')
 where wiki_path is null;

alter table public.scopes add column ai_context_snapshot text;

comment on column public.clients.wiki_path is
  'Repo-relative path to the client''s wiki folder (e.g. wiki/clients/Kings-College). Editable in the Clients page for naming-convention exceptions.';
comment on column public.scopes.ai_context_snapshot is
  'Exact <client_context> XML block injected into the AI prompt that produced this scope. Stored for debugging and prompt reproducibility.';
```

- [ ] **Step 2: Apply via MCP**

Run:
```
mcp__cc-supabase__apply_migration(
  name: "clients_wiki_path",
  query: <contents of file>
)
```

Expected: success.

- [ ] **Step 3: Verify the backfill**

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select name, wiki_path from public.clients where archived_at is null order by name limit 20;"
)
```

Expected: every row has a `wiki_path` of the form `wiki/clients/<Slug>` with no spaces.

- [ ] **Step 4: Regenerate types**

Run `mcp__cc-supabase__generate_typescript_types()` and write the result to `src/types/db.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0025_clients_wiki_path.sql src/types/db.ts
git commit -m "feat(db): clients.wiki_path + scopes.ai_context_snapshot"
```

---

## Task 2: Frontmatter parser

**Files:**
- Create: `supabase/functions/_shared/frontmatter.ts`
- Create: `supabase/functions/_shared/frontmatter.test.ts`

We don't pull in `gray-matter` (Node-only). Use Deno's YAML parser from `std@0.224.0/yaml/mod.ts` with a regex split.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/frontmatter.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseFrontmatter } from "./frontmatter.ts";

Deno.test("parses --- delimited frontmatter and body", () => {
  const md = `---\ntitle: "Kings"\ncontext: hidden\n---\n\nbody here\n`;
  const { frontmatter, body } = parseFrontmatter(md);
  assertEquals(frontmatter.title, "Kings");
  assertEquals(frontmatter.context, "hidden");
  assertEquals(body.trim(), "body here");
});

Deno.test("returns body as-is when no frontmatter is present", () => {
  const md = `# Heading\n\ncontent`;
  const { frontmatter, body } = parseFrontmatter(md);
  assertEquals(frontmatter, {});
  assertEquals(body, md);
});

Deno.test("returns empty frontmatter on parse error and keeps original body", () => {
  const md = `---\nthis is: not\n  valid: yaml: at all\n---\n\ntext`;
  const { frontmatter, body } = parseFrontmatter(md);
  assertEquals(frontmatter, {});
  assertEquals(body.includes("text"), true);
});

Deno.test("recognises CRLF line endings", () => {
  const md = `---\r\ntitle: x\r\n---\r\n\r\nbody\r\n`;
  const { frontmatter, body } = parseFrontmatter(md);
  assertEquals(frontmatter.title, "x");
  assertEquals(body.trim(), "body");
});
```

- [ ] **Step 2: Run — expect "Module not found"**

Run: `deno test --allow-read supabase/functions/_shared/frontmatter.test.ts`

- [ ] **Step 3: Write the parser**

Create `supabase/functions/_shared/frontmatter.ts`:

```ts
// Minimal frontmatter parser: detects an opening '---' fence on the first line,
// reads to the next '---' line, parses the contents as YAML.
//
// On parse error or no fence, returns empty frontmatter and the original body.

import { parse as parseYaml } from "https://deno.land/std@0.224.0/yaml/parse.ts";

export type Frontmatter = Record<string, unknown>;

const FENCE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;

export function parseFrontmatter(input: string): { frontmatter: Frontmatter; body: string } {
  const m = input.match(FENCE);
  if (!m) return { frontmatter: {}, body: input };

  let parsed: unknown;
  try {
    parsed = parseYaml(m[1]);
  } catch {
    return { frontmatter: {}, body: input };
  }
  const frontmatter = parsed && typeof parsed === "object" ? (parsed as Frontmatter) : {};
  const body = input.slice(m[0].length);
  return { frontmatter, body };
}
```

- [ ] **Step 4: Run — expect 4/4 pass**

Run: `deno test --allow-read supabase/functions/_shared/frontmatter.test.ts` → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/frontmatter.ts supabase/functions/_shared/frontmatter.test.ts
git commit -m "feat(edge): minimal frontmatter parser (Deno YAML std)"
```

---

## Task 3: `wiki-context.ts` — fetch + assemble client_context block

**Files:**
- Create: `supabase/functions/_shared/wiki-context.ts`
- Create: `supabase/functions/_shared/wiki-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/wiki-context.test.ts`:

```ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assembleClientContextBlock, isPathSafe } from "./wiki-context.ts";

Deno.test("assembleClientContextBlock builds the spec'd XML envelope", () => {
  const xml = assembleClientContextBlock({
    clientName: "Kings College",
    wikiPath: "wiki/clients/Kings-College",
    notes: [
      { path: "index.md", body: "Top-level overview" },
      { path: "brand.md", body: "Brand voice notes" },
    ],
  });
  assertStringIncludes(xml, '<client_context client_name="Kings College" wiki_path="wiki/clients/Kings-College">');
  assertStringIncludes(xml, '<note path="index.md">');
  assertStringIncludes(xml, "Top-level overview");
  assertStringIncludes(xml, "Brand voice notes");
  assertStringIncludes(xml, "</client_context>");
});

Deno.test("assembleClientContextBlock with empty notes returns the empty envelope", () => {
  const xml = assembleClientContextBlock({
    clientName: "X",
    wikiPath: "wiki/clients/X",
    notes: [],
  });
  assertStringIncludes(xml, '<client_context client_name="X" wiki_path="wiki/clients/X">');
  assertStringIncludes(xml, "</client_context>");
});

Deno.test("isPathSafe rejects parent-traversal", () => {
  assertEquals(isPathSafe("wiki/clients/Kings-College"), true);
  assertEquals(isPathSafe("wiki/clients/Kings-College/brand.md"), true);
  assertEquals(isPathSafe("wiki/clients/../etc"), false);
  assertEquals(isPathSafe("../config"), false);
  assertEquals(isPathSafe("wiki/clients/Kings/./.."), false);
});

Deno.test("assembleClientContextBlock escapes XML-special characters in attributes", () => {
  const xml = assembleClientContextBlock({
    clientName: 'AT&T <Foo>',
    wikiPath: "wiki/clients/AT-T",
    notes: [],
  });
  assertStringIncludes(xml, 'client_name="AT&amp;T &lt;Foo&gt;"');
});
```

- [ ] **Step 2: Run — expect "Module not found"**

Run: `deno test --allow-read supabase/functions/_shared/wiki-context.test.ts`

- [ ] **Step 3: Write the helper**

Create `supabase/functions/_shared/wiki-context.ts`:

```ts
// Loads a client's Obsidian wiki folder from GitHub and assembles a
// <client_context> XML block for injection into AI prompts.

import { parseFrontmatter } from "./frontmatter.ts";

type GitHubContentsItem = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url?: string;
};

type Note = { path: string; body: string };

const GH_API = "https://api.github.com";

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isPathSafe(p: string): boolean {
  if (!p) return false;
  // Reject absolute paths, parent traversal, and any "." segment.
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  return !p
    .split(/[\\/]/)
    .some((segment) => segment === ".." || segment === ".");
}

export function assembleClientContextBlock(input: {
  clientName: string;
  wikiPath: string;
  notes: Note[];
}): string {
  const open = `<client_context client_name="${escapeXmlAttr(input.clientName)}" wiki_path="${escapeXmlAttr(input.wikiPath)}">`;
  const inner = input.notes
    .map((n) => `  <note path="${escapeXmlAttr(n.path)}">\n${n.body}\n  </note>`)
    .join("\n");
  return `${open}\n${inner}\n</client_context>`;
}

async function ghFetchOnce(url: string, pat: string): Promise<Response> {
  return await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cc-service-calculator-edge",
    },
  });
}

async function ghFetch(url: string, pat: string): Promise<Response> {
  const first = await ghFetchOnce(url, pat);
  if (first.ok || first.status === 404) return first;
  if (first.status === 403 || (first.status >= 500 && first.status < 600)) {
    await new Promise((r) => setTimeout(r, 1000));
    return await ghFetchOnce(url, pat);
  }
  return first;
}

async function listMarkdownFiles(
  repo: string,
  branch: string,
  dirPath: string,
  pat: string,
): Promise<GitHubContentsItem[]> {
  if (!isPathSafe(dirPath)) return [];
  const url = `${GH_API}/repos/${repo}/contents/${encodeURI(dirPath)}?ref=${encodeURIComponent(branch)}`;
  const res = await ghFetch(url, pat);
  if (!res.ok) return [];
  const items = (await res.json()) as GitHubContentsItem[] | unknown;
  if (!Array.isArray(items)) return [];

  const out: GitHubContentsItem[] = [];
  for (const item of items) {
    if (item.type === "file" && item.name.endsWith(".md")) {
      out.push(item);
    } else if (item.type === "dir") {
      const nested = await listMarkdownFiles(repo, branch, item.path, pat);
      out.push(...nested);
    }
  }
  return out;
}

/**
 * Loads the client's wiki folder, filters out notes with `context: hidden`
 * frontmatter, and returns the rendered <client_context> XML block.
 *
 * Always returns a string. Errors are swallowed and logged — wiki context is
 * best-effort; we never fail a brief over a context fetch.
 */
export async function loadClientWikiContext(input: {
  clientName: string;
  wikiPath: string | null;
}): Promise<string> {
  const repo = Deno.env.get("WIKI_GITHUB_REPO");
  const pat = Deno.env.get("WIKI_GITHUB_PAT");
  const branch = Deno.env.get("WIKI_GITHUB_BRANCH") ?? "main";

  if (!repo || !pat || !input.wikiPath) {
    return assembleClientContextBlock({
      clientName: input.clientName,
      wikiPath: input.wikiPath ?? "(unset)",
      notes: [],
    });
  }

  let files: GitHubContentsItem[] = [];
  try {
    files = await listMarkdownFiles(repo, branch, input.wikiPath, pat);
  } catch (e) {
    console.warn("loadClientWikiContext list failed:", e);
  }

  const notes: Note[] = [];
  for (const f of files) {
    if (!f.download_url) continue;
    try {
      const res = await ghFetch(f.download_url, pat);
      if (!res.ok) continue;
      const raw = await res.text();
      const { frontmatter, body } = parseFrontmatter(raw);
      if (frontmatter.context === "hidden") continue;
      const relPath = f.path.startsWith(input.wikiPath + "/")
        ? f.path.slice(input.wikiPath.length + 1)
        : f.path;
      notes.push({ path: relPath, body: body.trim() });
    } catch (e) {
      console.warn(`loadClientWikiContext file ${f.path} failed:`, e);
    }
  }

  return assembleClientContextBlock({
    clientName: input.clientName,
    wikiPath: input.wikiPath,
    notes,
  });
}
```

- [ ] **Step 4: Run — expect 4/4 pass**

Run: `deno test --allow-read supabase/functions/_shared/wiki-context.test.ts` → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/wiki-context.ts supabase/functions/_shared/wiki-context.test.ts
git commit -m "feat(edge): wiki-context loader + client_context XML assembler"
```

---

## Task 4: Modify `draft-scope` to inject wiki context

**Files:**
- Modify: `supabase/functions/draft-scope/index.ts`

- [ ] **Step 1: Read the existing function** (already read in plan-prep — the file is short, ~87 lines)

- [ ] **Step 2: Edit the imports + select the new column**

Replace the import block and the brief select to include `wiki_path` from clients.

In `supabase/functions/draft-scope/index.ts`:

Find:
```ts
import { callAnthropic } from "../_shared/anthropic.ts";
```

Add immediately below:
```ts
import { loadClientWikiContext } from "../_shared/wiki-context.ts";
```

Find:
```ts
      supabase.from("briefs").select("*, client:clients(name)").eq("id", brief_id).single(),
```

Replace with:
```ts
      supabase.from("briefs").select("*, client:clients(id,name,wiki_path)").eq("id", brief_id).single(),
```

- [ ] **Step 3: Add the context fetch + prompt injection**

Find the block:
```ts
    const clientName = (brief as { client?: { name: string } | null }).client?.name;
    const user = [
      clientName ? `Client: ${clientName}` : null,
      `Subject: ${brief.raw_subject ?? "(none)"}`,
      "",
      "Body:",
      brief.raw_body,
      nudge ? `\n\nAdditional guidance from staff: ${nudge}` : null,
    ].filter(Boolean).join("\n");
```

Replace with:
```ts
    type ClientLite = { id: string; name: string; wiki_path: string | null } | null;
    const client = (brief as { client?: ClientLite }).client ?? null;

    const clientContextBlock = client
      ? await loadClientWikiContext({ clientName: client.name, wikiPath: client.wiki_path })
      : "";

    const user = [
      clientContextBlock || null,
      client ? `Client: ${client.name}` : null,
      `Subject: ${brief.raw_subject ?? "(none)"}`,
      "",
      "Body:",
      brief.raw_body,
      nudge ? `\n\nAdditional guidance from staff: ${nudge}` : null,
    ].filter(Boolean).join("\n\n");
```

- [ ] **Step 4: Snapshot the rendered context to `scopes.ai_context_snapshot`**

Find the upsert block:
```ts
    await supabase
      .from("scopes")
      .upsert(
        { brief_id, ...scope, ai_drafted: true, updated_at: new Date().toISOString() },
        { onConflict: "brief_id" },
      );
```

Replace with:
```ts
    await supabase
      .from("scopes")
      .upsert(
        {
          brief_id,
          ...scope,
          ai_drafted: true,
          ai_context_snapshot: clientContextBlock || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "brief_id" },
      );
```

- [ ] **Step 5: Update the system prompt to acknowledge the context block**

Find the `const system = [...]` array and replace with:

```ts
    const system = [
      "You are a digital agency scoping analyst at Converted Click.",
      "A client sent a request. The user message may include a <client_context> block at the top —",
      "if present, treat the embedded notes as authoritative background on the client's brand,",
      "preferences, and prior decisions. Use them to disambiguate the brief, but never invent",
      "scope items that aren't either explicitly requested in the brief or supported by the context.",
      "Rewrite the brief as:",
      "1) enhanced_prose — one-paragraph clarified summary",
      "2) in_scope — bullet list of explicit in-scope items",
      "3) out_of_scope — bullet list of likely out-of-scope items to confirm exclusion",
      "4) open_questions — bullet list of questions to ask before quoting",
      'Return JSON only: {"enhanced_prose":"","in_scope":[],"out_of_scope":[],"open_questions":[]}.',
      "Do not invent services or commitments.",
    ].join("\n");
```

- [ ] **Step 6: Deploy via MCP**

Run:
```
mcp__cc-supabase__deploy_edge_function(
  name: "draft-scope",
  files: [
    { name: "index.ts", content: <full contents of the modified file> }
  ]
)
```

Expected: success.

- [ ] **Step 7: Smoke-test against a known client**

Pick an existing brief whose `client_id` points at a client with a populated wiki folder (e.g. Kings College). In the calculator UI, open the brief's Scope page and click the "Draft with AI" button. Watch the network tab.

Expected:
- Edge function returns 200 with a scope JSON.
- `scopes.ai_context_snapshot` for that brief contains the rendered `<client_context>` XML.

Verify with:
```
mcp__cc-supabase__execute_sql(
  query: "select brief_id, length(ai_context_snapshot) as ctx_len, substring(ai_context_snapshot from 1 for 200) as ctx_head from public.scopes where ai_context_snapshot is not null order by updated_at desc limit 5;"
)
```

Expected: `ctx_len > 100`, `ctx_head` starts with `<client_context client_name="…"`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/draft-scope/index.ts
git commit -m "feat(ai): draft-scope injects per-client wiki context"
```

---

## Task 5: `provision-client-wiki` edge function

**Files:**
- Create: `supabase/functions/provision-client-wiki/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Register in `supabase/config.toml`**

Append:

```toml
[functions.provision-client-wiki]
verify_jwt = false
```

- [ ] **Step 2: Write the function**

Create `supabase/functions/provision-client-wiki/index.ts`:

```ts
// supabase/functions/provision-client-wiki/index.ts
//
// Request:  POST { client_id: string }
// Response: 200 { wiki_path: string, created: boolean }
//
// Writes a starter index.md into the client's wiki folder via GitHub Contents
// API. Fire-and-forget from useCreateClient. 409 (file exists) → silent ok.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { isPathSafe } from "../_shared/wiki-context.ts";

const STARTER_TEMPLATE = (clientName: string, isoDate: string) => `---
type: client
title: "${clientName.replace(/"/g, '\\"')}"
created: ${isoDate}
status: active
tags: [client]
---

# ${clientName}

## About

## Brand

## Decisions
`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { client_id } = await req.json();
    if (!client_id) return json({ error: "client_id required" }, 400);

    const supabase = createServiceRoleClient();
    const { data: client, error } = await supabase
      .from("clients")
      .select("id, name, wiki_path")
      .eq("id", client_id)
      .single();
    if (error || !client) return json({ error: "Client not found" }, 404);

    const repo = Deno.env.get("WIKI_GITHUB_REPO");
    const pat = Deno.env.get("WIKI_GITHUB_PAT");
    const branch = Deno.env.get("WIKI_GITHUB_BRANCH") ?? "main";
    if (!repo || !pat) {
      console.warn("WIKI_GITHUB_REPO / WIKI_GITHUB_PAT not set — skipping provision");
      return json({ wiki_path: client.wiki_path, created: false, skipped: true });
    }

    const wikiPath = client.wiki_path ?? `wiki/clients/${client.name.replace(/[^A-Za-z0-9]+/g, "-")}`;
    if (!isPathSafe(wikiPath)) return json({ error: "Unsafe wiki_path" }, 400);

    const filePath = `${wikiPath}/index.md`;
    const content = STARTER_TEMPLATE(client.name, new Date().toISOString().slice(0, 10));
    const contentB64 = btoa(unescape(encodeURIComponent(content)));

    const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(filePath)}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cc-service-calculator-edge",
      },
      body: JSON.stringify({
        message: `chore(wiki): provision ${client.name}`,
        content: contentB64,
        branch,
      }),
    });

    if (res.status === 201 || res.status === 200) {
      return json({ wiki_path: wikiPath, created: true });
    }
    if (res.status === 422) {
      // Body parse problem — log but don't 500 (fire-and-forget caller).
      const text = await res.text();
      console.warn("provision-client-wiki 422:", text);
      return json({ wiki_path: wikiPath, created: false });
    }
    if (res.status === 409) {
      // File already exists — silent no-op per spec.
      return json({ wiki_path: wikiPath, created: false });
    }
    // Anything else: log and return 200 — never block client creation.
    const text = await res.text();
    console.warn(`provision-client-wiki ${res.status}:`, text);
    return json({ wiki_path: wikiPath, created: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("provision-client-wiki error:", msg);
    // Return 200 — caller is fire-and-forget; surfacing 500 would create a
    // toast for an error the user can't act on.
    return json({ created: false });
  }
});
```

- [ ] **Step 3: Deploy via MCP**

Run:
```
mcp__cc-supabase__deploy_edge_function(
  name: "provision-client-wiki",
  files: [
    { name: "index.ts", content: <contents above> }
  ]
)
```

Expected: success.

- [ ] **Step 4: Smoke-test (manual)**

Pick a client whose `wiki_path` does NOT yet exist on disk. Call the function from the browser console while signed in:

```js
const { data } = await window.supabase.functions.invoke("provision-client-wiki", { body: { client_id: "<some-client-id>" } });
console.log(data);
```

Expected: `{ wiki_path: "wiki/clients/<Slug>", created: true }`. Refresh GitHub — the file should exist.

Re-run the same call → expected: `{ wiki_path: "...", created: false }` (409 silent path).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/provision-client-wiki/index.ts supabase/config.toml
git commit -m "feat(edge): provision-client-wiki writes starter index.md"
```

---

## Task 6: Wire `useCreateClient` to fire-and-forget provision

**Files:**
- Modify: `src/hooks/useClients.ts`

- [ ] **Step 1: Update `useCreateClient` to invoke the function on success**

In `src/hooks/useClients.ts`, find:

```ts
export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInsert) => {
      const { data, error } = await supabase.from("clients").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}
```

Replace with:

```ts
export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInsert) => {
      const { data, error } = await supabase.from("clients").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: LIST });
      // Fire-and-forget wiki provisioning. Failures are logged on the edge
      // side and do NOT surface to the user — wiki provision must not block
      // client creation. We don't await; the toast in the UI fires from the
      // mutationFn return.
      void supabase.functions
        .invoke("provision-client-wiki", { body: { client_id: created.id } })
        .catch((e) => console.warn("provision-client-wiki failed:", e));
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

`npm run typecheck` → expect clean.

- [ ] **Step 3: Smoke-test in the dev server**

Run: `npm run dev`. In `/clients`, create a new client (any name not yet present). Wait a few seconds, then check the wiki repo on GitHub — `wiki/clients/<NewName>/index.md` should appear.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useClients.ts
git commit -m "feat(clients): fire provision-client-wiki on create"
```

---

## Task 7: Add `wiki_path` column to Clients page

**Files:**
- Modify: `src/pages/Clients.tsx`

- [ ] **Step 1: Locate the table header in `Clients.tsx`**

Find the `<thead>` row (search for `<th` to locate it). The current columns are: Name, Domain, ClickUp Folder, Status, Actions.

- [ ] **Step 2: Add a `Wiki path` header**

Insert a new `<th>` between "ClickUp Folder" and "Status":

```tsx
<th className="py-2 pl-2 pr-2 text-left text-label-large">Wiki path</th>
```

- [ ] **Step 3: Add an editable `<td>` to `ClientRow`**

In the `ClientRow` function (search for `function ClientRow`), insert a new cell between the ClickUp folder cell and the status cell:

```tsx
<td className="py-3 pl-2 pr-2 w-56">
  <Input
    defaultValue={c.wiki_path ?? ""}
    placeholder="wiki/clients/Slug"
    onBlur={(e) => {
      const v = e.target.value.trim() || null;
      if (v !== c.wiki_path) {
        update.mutate(
          { id: c.id, patch: { wiki_path: v } },
          { onSuccess: () => toast.success("Saved") },
        );
      }
    }}
  />
</td>
```

- [ ] **Step 4: Run typecheck + dev server smoke**

`npm run typecheck` → clean.
`npm run dev` → open `/clients`, edit a client's wiki path, blur the input, expect a toast and refresh-survival.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Clients.tsx
git commit -m "feat(clients): editable wiki_path column"
```

---

## Task 8: End-to-end manual verification (Brendan)

No code changes. Validates the spec's "after Phase 3" sign-off criterion: AI uses wiki content meaningfully on at least 3 real briefs.

- [ ] **Step 1: Pick three real briefs that already have a `client_id`** for a client with a populated wiki folder.

- [ ] **Step 2: For each, run "Draft with AI" on the Scope page.**

Expected:
- AI output references brand/voice/decision content from the wiki where relevant.
- `scopes.ai_context_snapshot` contains the exact `<client_context>` XML fed into the prompt.

Run after each:
```
mcp__cc-supabase__execute_sql(
  query: "select b.raw_subject, c.name as client, length(s.ai_context_snapshot) as ctx_len from public.scopes s join public.briefs b on b.id = s.brief_id left join public.clients c on c.id = b.client_id where s.brief_id = '<the-brief-id>';"
)
```

- [ ] **Step 3: Test the `context: hidden` filter**

In the wiki, mark one note in a chosen client's folder with frontmatter `context: hidden: true`. Re-run draft-scope. Expected: that note's body does NOT appear in the new `ai_context_snapshot`.

- [ ] **Step 4: Test the missing-folder fallback**

Pick a client whose wiki folder doesn't exist (e.g. set `wiki_path` to a bogus path). Re-run draft-scope. Expected: the function still returns a scope (no 5xx); `ai_context_snapshot` contains an empty `<client_context>` envelope (no notes inside).

- [ ] **Step 5: Sign off**

If all four checks pass: Phase 3 complete; Inbox v2 spec fully shipped.

---

## Self-review checklist

- [x] Migration covers `clients.wiki_path` (with backfill) + `scopes.ai_context_snapshot`
- [x] `loadClientWikiContext` covers: GitHub Contents API list, recursive `.md` walk, frontmatter parse, `context: hidden` filter, XML envelope assembly, retry-once on 403/5xx, path-safety check
- [x] `draft-scope` modified to: select `wiki_path`, fetch context, inject `<client_context>` block as the first user-message segment, snapshot the block to `scopes.ai_context_snapshot`, update the system prompt to reference the block
- [x] `provision-client-wiki` covers: starter template, slugify fallback, 409 silent no-op, never returns non-200 (fire-and-forget caller)
- [x] `useCreateClient` fires the provisioning function without blocking the create mutation
- [x] Clients page exposes `wiki_path` for naming-convention exceptions
- [x] All file paths exact; types and method names consistent across tasks
- [x] No placeholders; tests written for frontmatter parsing, context-block assembly, path safety
- [x] Brendan's out-of-band prerequisites listed at the top with checkboxes

**Spec coverage gaps intentionally documented:**
- Spec calls for `gray-matter` (Node lib). Plan uses Deno's `std/yaml` parser via a local `frontmatter.ts` helper to avoid pulling Node deps into the Deno runtime. Behaviour-equivalent for our use (`context: hidden` boolean filter).
- Spec leaves the GitHub branch implicit. Plan adds `WIKI_GITHUB_BRANCH` secret defaulting to `main` so prerequisite P3 is explicit.
