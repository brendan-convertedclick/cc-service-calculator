# CC Calculator MCP Server — Design Spec
**Date:** 2026-05-09
**Status:** approved for implementation
**Repo:** cc-service-calculator

---

## Problem

The auto-scope intake pipeline (gmail-relay → auto-scope Edge Function) is triggered via Apps Script labels. A Claude agent that reads Gmail directly via the Gmail MCP has no way to write briefs into the calculator, check for duplicates, or look up whether a client already has active projects or a retainer. This MCP server is the data bridge that makes the calculator's intake layer accessible to any Claude session as tool calls.

---

## Architecture

A Node.js TypeScript MCP server using `@modelcontextprotocol/sdk`, living at `mcp-server/` inside the `cc-service-calculator` repo. Stdio transport — Claude Code loads it as a local MCP server. Connects to Supabase via the service role key (trusted internal tool, not user-facing). Registered in `.mcp.json` alongside the existing `cc-supabase` entry.

```
Gmail agent session
  │
  ├── Gmail MCP          → read emails
  ├── cc-vault MCP       → read wiki client context
  └── cc-calculator MCP  → find-client, check-duplicate, get-active-projects,
                            get-active-retainer, list-briefs, get-brief,
                            create-brief (idempotent, fires auto-scope)
```

The server never duplicates logic from Edge Functions. Read tools query Supabase directly via `@supabase/supabase-js`. The one write tool (`create-brief`) handles dedup + insert + auto-scope trigger atomically.

### Typical agent flow for one email

```
find-client(email_domain)         → { id, name, wiki_path } or null
check-duplicate-brief(thread_id)  → null  (not seen before)
get-active-projects(client_id)    → [] or [{ id, name, project_code, status }]
get-active-retainer(client_id)    → null or { id, name, scope_summary }
create-brief(thread_id, ...)      → { brief_id, created: true }
                                      ↳ auto-scope fires in background
```

The agent passes `get-active-projects` and `get-active-retainer` results to Claude alongside the email body so it can reason about intent before `create-brief` writes.

---

## Tools

### Read tools

**`find-client`**
- Input: `{ email_domain?: string; name?: string }` — at least one required
- Queries `clients` table: `ilike primary_domain` or `ilike name`
- Returns: `{ id, name, wiki_path, primary_domain }` or `null`
- Used to resolve sender → client before any other call

**`check-duplicate-brief`**
- Input: `{ gmail_thread_id: string }`
- Queries `briefs` table: `eq gmail_thread_id`
- Returns: `{ brief_id: string }` or `null`
- Lets the agent bail early if the thread is already in the inbox

**`get-active-projects`**
- Input: `{ client_id: string }`
- Queries `projects` table: `eq client_id`, `in status ['active','in_progress']`
- Returns: `[{ id, name, project_code, status, created_at }]` (empty array if none)
- Agent passes this to Claude to help classify `project_thread` vs `new_brief`

**`get-active-retainer`**
- Input: `{ client_id: string }`
- Queries `briefs` where `client_id = ?` AND `intent_type = 'retainer_thread'` AND `status NOT IN ('closed', 'spam')`, ordered by `created_at DESC`, limit 1. Then fetches the associated `scopes` row for `enhanced_prose`.
- Returns: `{ brief_id, subject: raw_subject, scope_summary: enhanced_prose }` or `null`
- Agent passes this to Claude to help classify `retainer_thread` vs `new_brief`

**`list-briefs`**
- Input: `{ client_id?: string; status?: string; intent_type?: string; limit?: number }` (limit default 20)
- Returns: `[{ id, raw_subject, sender_email, status, intent_type, created_at, message_count }]`
- Used for overview queries: "what briefs do we have open for Acme?"

**`get-brief`**
- Input: `{ brief_id: string }`
- Returns: full brief row + scope fields (`enhanced_prose`, `in_scope_md`, `out_of_scope_md`, `open_questions_md`, `scope_type`) + `intent_type` + `draft_reply`
- Used when the agent needs to read what was scoped for a specific brief

### Write tool

**`create-brief`**
- Input:
  ```
  {
    gmail_thread_id: string   // dedup key
    subject: string
    body: string
    sender_email: string
    sender_name?: string
    client_id?: string        // from find-client; null if unknown sender
  }
  ```
- Behaviour (idempotent):
  1. Check `briefs` for existing `gmail_thread_id` — if found, return `{ brief_id, created: false }`
  2. Insert new `briefs` row (`source: 'gmail_relay'`, `status: 'new'`)
  3. Fire-and-forget fetch to `auto-scope` Edge Function (same pattern as `gmail-relay`)
  4. Return `{ brief_id, created: true }`
- Never throws on auto-scope failure — brief is always returned

---

## File Structure

```
cc-service-calculator/
└── mcp-server/
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    └── src/
        ├── index.ts                      server entry — registers all tools, starts stdio
        ├── supabase.ts                   createClient(service role)
        ├── auto-scope.ts                 fire-and-forget fetch helper
        └── tools/
            ├── find-client.ts            definition + handler
            ├── check-duplicate-brief.ts  definition + handler
            ├── get-active-projects.ts    definition + handler
            ├── get-active-retainer.ts    definition + handler
            ├── list-briefs.ts            definition + handler
            ├── get-brief.ts              definition + handler
            └── create-brief.ts          definition + handler
```

Each tool file exports:
```typescript
export const definition: Tool  // MCP tool schema (name, description, inputSchema)
export async function handler(input: unknown): Promise<CallToolResult>
```

`index.ts` imports all seven definitions and handlers, registers them with `server.tool()`, and starts the stdio server.

---

## `.mcp.json` Registration

Add alongside existing `cc-supabase` entry:

```json
"cc-calculator": {
  "command": "node",
  "args": ["mcp-server/dist/index.js"],
  "cwd": "/Users/brendangunn/Github/cc-service-calculator",
  "env": {
    "SUPABASE_URL": "<from .env.local>",
    "SUPABASE_SERVICE_ROLE_KEY": "<from .env.local>"
  }
}
```

The server must be built (`npm run build` inside `mcp-server/`) before Claude Code can load it. A `build` npm script compiles TypeScript to `mcp-server/dist/`.

---

## Error Handling

- Every handler wraps its Supabase call in try/catch
- On error: return `{ content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true }`
- Read tools return `null` (not error) when a record is simply not found — this is not an error state
- `create-brief` auto-scope failure is logged to stderr, never surfaced as a tool error

---

## Out of Scope

- Authentication / per-user RLS — server uses service role, intended for internal agent use only
- Tools for updating briefs, locking scopes, or managing quotes — add in a future iteration when agent writes beyond intake are needed
- Xero or ClickUp tool wrappers — separate MCP concern

---

## Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.x",
  "@supabase/supabase-js": "^2.x",
  "zod": "^3.x"
}
```

Dev: `typescript`, `@types/node`, `tsx` (for development), `esbuild` or `tsc` for build.
