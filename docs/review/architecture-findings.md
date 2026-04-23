# Architecture Review — cc-service-calculator

**Date:** 2026-04-22  
**Reviewer:** Architecture specialist  
**Scope:** High-level structure, layering, frontend/edge/DB boundaries, domain model, integrations, config, testing.

---

## Summary — Top 5 Structural Issues

1. **Pages contain multi-step orchestration that belongs in a dedicated workflow layer.** `ProjectBuilder.tsx` (583 lines) coordinates 5+ mutations, 4 async operations, auto-creates quotes on mount, calls two different edge functions, and finalises a quote. This is workflow logic scattered across a React component.

2. **`master-sows.json` is shipped to the browser and forwarded as a request body to the `draft-sow` edge function.** The JSON is loaded in `ProjectBuilder.tsx` via `import masterSows from "@/data/master-sows.json"` and then sent in the POST body. The edge function could load this from a DB table or Storage object directly; the current design bloats the request and exposes internal SOW template content to the client.

3. **Duplicate business logic between `src/lib/clickup-shared.ts` (browser) and `supabase/functions/push-to-clickup/index.ts` (edge).** `clickup-shared.ts` exports `buildBriefComment` and `resolveListAlias` but the edge function builds the `BRIEF::` comment inline (line 172–181) rather than calling the shared lib. The comment in `clickup-shared.ts` itself admits this: "Phase 3 will swap to an envelope… instead of duplicating here." Until then, the two implementations can diverge silently.

4. **No project-name resolution on the Projects list page.** `Projects.tsx` renders `ClickUp task {p.clickup_parent_task_id}` as the project title because `projects` has no `name` column — the name is only retrievable by joining `quotes → scopes → briefs`. The page fetches `projects` and `briefs` separately with no join, so pushed projects display raw ClickUp task IDs. This is a data model gap rather than just a display gap.

5. **Auth state is in component-local `useState`, not a React context.** Every subtree that calls `useAuth()` creates its own subscription to `supabase.auth.onAuthStateChange`. In the current router structure this creates two subscribers (RequireAuth + any child that calls useAuth), which is harmless now but becomes a leak vector as the app grows.

---

## Layering Assessment

### What is clean

- **Pure business logic is well-extracted.** `src/lib/allocation.ts`, `src/lib/quotes.ts`, `src/lib/scope-overlap.ts`, and `src/lib/mailto.ts` are all pure functions with no I/O. They are unit-tested and used from both pages and edge functions. This is the best layer in the codebase.
- **Hooks are consistently the data-access boundary.** All Supabase queries go through TanStack Query hooks in `src/hooks/`. Pages do not import `supabase` for reads (with one exception below). The mutation/invalidation pattern is uniform.
- **shadcn `ui/` primitives are isolated** and never import domain types. The boundary between design-system primitives and domain components is clear.

### What is mixed

- **Pages call `supabase` directly for reads.** `ProjectBuilder.tsx` at lines 249–263 fetches `quote_services` directly via `supabase.from(...)` inside a `useEffect` instead of using the `useQuote` hook (which already fetches `quote_services`). `QuoteSend.tsx` at lines 26–42 fetches the scope/brief/client chain directly rather than composing hooks. These are data-access bypasses that duplicate query logic and skip the cache.

- **Workflow orchestration sits in pages.** `ProjectBuilder.tsx` contains the entire quote-creation-on-mount effect, quote hydration, save-then-finalise, PDF rendering, and brief-status update sequence. None of this is reusable or independently testable. The same problem applies in `Scope.tsx` which auto-triggers `draft-scope` on first load and coordinates scope upsert + brief status in `lock()`.

- **`BriefRow.tsx` is a fat component.** It handles accept/spam/needsInfo actions (three mutations), client creation, email generation, and navigation. These responsibilities could be split into a stateless display component and an actions hook or parent handler.

- **Allocation sum validation is duplicated.** The `99.5–100.5` tolerance constant appears in `src/lib/allocation.ts` (exported), in `QuoteLineEditor.tsx` line 31 (hardcoded inline), in `supabase/migrations/0001_init.sql` as a trigger, and implicitly in the DB constraint comment. The frontend uses its own local check rather than importing from `allocation.ts`.

---

## Frontend ↔ Edge Function Boundary

### Well-placed at edge

| Function | Reason it belongs server-side |
|---|---|
| `generate-process-steps` | Anthropic API key; raw service data stays server-side |
| `draft-scope` | Anthropic API key |
| `suggest-services` | Anthropic API key |
| `draft-sow` | Anthropic API key; produces HTML fed to PDF |
| `render-sow-pdf` | CPU-bound PDF rendering; Supabase Storage write |
| `push-to-clickup` | ClickUp PAT; creates projects row + actuals atomically |
| `sync-clickup-actuals` | Scheduled background job; needs service_role key |

All 7 edge functions have correct reasons to exist server-side. No secret leaks in frontend code were found.

### Issues at the boundary

- **`master-sows.json` is sent by the browser** to `draft-sow` as part of the POST body (ProjectBuilder.tsx:364–366). The edge function could read from Supabase Storage or a `master_sows` DB table directly, eliminating the ~80 KB JSON round-trip and keeping SOW templates internal.

- **`push-to-clickup` uses `SUPABASE_ANON_KEY`** (line 49) and forwards the caller's JWT. This is correct for user-initiated pushes. The scheduled `sync-clickup-actuals` correctly uses `SUPABASE_SERVICE_ROLE_KEY`. No key confusion found.

- **CORS is `*` on all edge functions.** Acceptable for an internal tool where all access is gated by Supabase JWT, but worth narrowing to the Vite dev + production origin if the tool ever becomes semi-public.

- **Edge functions duplicate Supabase client creation boilerplate.** Each function repeats the same `createClient(URL, ANON_KEY, { global: { Authorization } })` setup. In Deno this can't easily be shared via a module, but a single shared `_shared/client.ts` import would reduce drift risk.

---

## Domain Model

### DB ↔ TypeScript alignment

`src/types/db.ts` is generated (1103 lines) and accurately reflects the schema. All hooks derive types via `Database["public"]["Tables"]["..."]["Row"]` which keeps them in sync with the schema. No impedance mismatch between DB types and hook types was found.

### Model gaps

- **`projects` has no `name` column.** The project's human-readable name is locked inside `quotes → scopes → briefs.raw_subject`. The Projects list page currently shows raw ClickUp task IDs as the title (Projects.tsx:97). A denormalised `name` column on `projects` (or a DB view joining the chain) would fix this.

- **`resumeHref` logic is duplicated.** `Inbox.tsx` and `Projects.tsx` both define an identical `resumeHref(b: Brief)` function that maps `brief.status` to a URL. This belongs in a shared `src/lib/brief-routing.ts` helper.

- **`STATUS_LABEL` is duplicated.** Same constant object appears in both `Inbox.tsx` and `Projects.tsx`.

- **`quote_services.allocation_override` and `hours_override` are typed as `jsonb` in the DB** but treated as `Record<string, number>` everywhere in the frontend. There is no runtime validation at the boundary — if the DB ever contains a different shape, `Number(r.pct ?? 0)` at ProjectBuilder.tsx:297 silently produces 0.

- **`line_items_jsonb` on quotes is a frozen snapshot** of `SnapshotLineItem[]`. The type is declared locally inside `push-to-clickup/index.ts` and `quotes.ts`. It is not in `db.ts` (expected, it's untyped jsonb). If the snapshot shape evolves, old rows will silently mismatch until something reads them. A version field inside the snapshot or a Zod schema at read time would make this safer.

---

## Integrations

### ClickUp

The integration is split across three surfaces:

1. `push-to-clickup` edge function — creates tasks, project row, actuals (server-side, correct).
2. `sync-clickup-actuals` edge function — polls task status/time entries on a pg_cron schedule (correct).
3. `src/lib/clickup-shared.ts` — shared alias/comment helpers **that are not actually used by the edge function**.

The comment in `clickup-shared.ts` says "Phase 3 will collapse the duplication." Until then, the `BRIEF::` comment grammar in `push-to-clickup` (line 172–181) can diverge from `buildBriefComment` in `clickup-shared.ts`. If the `/brief` skill changes the comment format, only the shared lib gets updated.

The ClickUp PAT is stored in the `settings` table and fetched at runtime. This means anyone with anon auth can read the PAT via `supabase.from("settings").select("*")` — the settings table has an `authenticated_all` RLS policy. This is acceptable for a single-login tool but is worth noting.

### Anthropic

Three edge functions (`draft-scope`, `suggest-services`, `draft-sow`) independently construct Anthropic API calls using raw `fetch`. `generate-process-steps` does the same with a hardcoded model `claude-sonnet-4-6` rather than reading from `settings.anthropic_model`. The other three read `settings.anthropic_model`. These should all read from settings.

All four use `cache_control: { type: "ephemeral" }` on the system prompt, which is correct for prompt caching.

### PDF

`render-sow-pdf` uses `@react-pdf/renderer` via Deno's npm: import. The HTML→PDF mapper is minimal (h1/h2/h3/p/ul/li only) and enforced by the `draft-sow` system prompt. Tags outside that set are silently dropped, which can produce blank sections. A response-validation step in `draft-sow` (checking that the returned HTML only uses allowed tags) would catch prompt drift.

### Figma token sync

Scripts in `scripts/sync-figma-tokens.ts` and `scripts/build-tokens.ts` run at dev time, not in the CI pipeline. The generated `src/styles/tokens.css` and `src/styles/tokens.ts` are committed. This is a reasonable trade-off for a small team, but it means a Figma change is only visible after a developer manually runs `npm run tokens:sync`. No automated check verifies that committed tokens match Figma state.

---

## Config, Env, Scripts

- `.env.local` (gitignored) holds `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `FIGMA_ACCESS_TOKEN`, `FIGMA_FILE_KEY`. None of the Vite-prefixed env vars contain secrets (anon key is public by design). The Anthropic key and ClickUp PAT are stored as Supabase Edge Function secrets, not in `.env.local`. This is correct.

- `scripts/import-csv.ts` (`npm run seed`) is a one-shot migration script. It has no guard against re-running (idempotency), which means running it twice would duplicate services. It should either upsert or check before inserting.

- `scripts/sync-sows.ts` writes to `src/data/master-sows.json`. This is committed and sent to the browser, then forwarded to an edge function. See master-sows.json note above.

- Migration `0002` is missing from `supabase/migrations/`. The numbering jumps from `0001_init.sql` to `0003_checklist_source_of_truth.sql`. This could indicate a migration was applied manually and never committed, or was deleted. If the local and remote schemas diverge this will cause silent breakage in CI-driven migrations.

- `supabase/migrations/0011_cron_sync_actuals.sql` schedules an HTTP POST to the edge function URL via pg_cron + pg_net. The URL is hardcoded as `https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/sync-clickup-actuals`. This is fine for a single-environment project but will need updating if the project ref changes or if a staging branch is used.

---

## Error Handling and Data Flow

- **Errors from Supabase in hooks are thrown** and surface as TanStack Query error states. Pages do not consistently check `isError` or render error UI — most show "Loading…" until data arrives and silently stay there if a query errors. Only toast-based feedback exists for mutations.

- **Mutation error handling is consistent**: every `onError` or catch block calls `toast.error(e instanceof Error ? e.message : "...")`. This is good.

- **No optimistic updates.** All mutations invalidate queries and wait for a refetch. For a low-latency internal tool this is fine.

- **`useEffect` with `supabase.functions.invoke` in Scope.tsx** (auto-draft on first load, line 61–65) has a stale-closure risk: if `brief` and `scope` change simultaneously, the effect may fire twice. The `autoDraftAttempted` guard mitigates this but makes the logic harder to follow.

---

## Auth and Session

- `useAuth` uses local `useState` and `useEffect` to track the Supabase session. This is correct and simple for a single-login tool.
- `RequireAuth` wraps all authenticated routes as a layout route in `App.tsx`. This is the right pattern.
- There is no React context for auth — components that need the user name call `useCurrentUserName()` which calls `supabase.auth.getSession()` inside a useEffect. Each call creates an independent session fetch. Wrapping in an `AuthContext` would make this a single fetch shared across the tree.
- No ad-hoc session state was found outside `useAuth` and `RequireAuth`.

---

## Routing

- Routes are declared in a single flat `Routes` block in `App.tsx`, nested under `RequireAuth → AppShell`. This is clean and the nesting is appropriate — auth guard and shell are layout routes, leaf routes are pages.
- No business logic lives in the route config itself.
- Route params are typed only by convention (string | undefined from `useParams`). No route schema library (e.g. TanStack Router typed routes) is used, so a mistyped param path would only surface at runtime.

---

## Shared vs Per-Route State

| State type | Where it lives |
|---|---|
| Auth session | `useAuth` local state + Supabase's internal storage |
| All entity queries | TanStack Query cache (keyed by entity + id) |
| Quote builder editor state (lines, margin, discount, SOW) | `ProjectBuilder` component state |
| Scope editor values | `Scope` component state |
| UI (expanded rows, modals) | Component local state |

No localStorage use was found. No React context outside of the TanStack Query and Sonner providers. No URL-encoded state (filter params, pagination) — all page-level state is in component memory and resets on navigation. For a low-traffic internal tool this is acceptable, but the quote builder losing unsaved work on accidental navigation is a latent UX problem.

---

## Testing Shape

Only 4 test files exist:

| File | What it tests |
|---|---|
| `src/lib/allocation.test.ts` | Pure allocation math |
| `src/lib/quotes.test.ts` | Pure quote aggregation / snapshot |
| `src/lib/scope-overlap.test.ts` | Jaccard similarity |
| `src/lib/mailto.test.ts` | mailto URL builder |

All tested code is pure functions in `src/lib/`. Zero test coverage for:

- Hooks (no mock-Supabase tests)
- Pages (no integration tests)
- Edge functions (no Deno test files)
- ClickUp shared utilities (`clickup-shared.ts` has a test file listed… actually no — checking: there is a `clickup-shared.test.ts`)

`src/lib/clickup-shared.test.ts` does exist. So 5 test files total, all pure-unit.

The gap is that the edge functions, hooks, and page orchestration are entirely untested. The most valuable logic to add tests for would be `push-to-clickup` (which creates DB rows and ClickUp tasks atomically) and the `ProjectBuilder` quote-finalisation flow.

---

## Proposed Target Architecture

If rebuilding today with the same requirements:

```
Browser (React SPA)
│
├── src/pages/          ← display only; no mutations or multi-step flows
├── src/features/       ← one folder per domain aggregate
│   ├── briefs/         ← BriefRow, useBriefs, brief-routing.ts
│   ├── scopes/         ← ScopeEditor, useScopes, scope-overlap.ts
│   ├── quotes/         ← QuoteLineEditor, useQuotes, quote-builder hook
│   ├── projects/       ← BurnChart, useProjects
│   └── services/       ← ServicePicker, AllocationEditor, useServices
├── src/lib/            ← pure domain functions (current shape is good)
├── src/hooks/          ← keep as thin Supabase wrappers; no logic
└── src/context/        ← AuthContext (single session subscription)
│
HTTP (Supabase JS client, anon key + JWT)
│
Supabase Edge Functions (Deno)
├── draft-scope         ← Anthropic AI
├── suggest-services    ← Anthropic AI  
├── generate-process-steps ← Anthropic AI
├── draft-sow           ← Anthropic AI (reads master_sows from DB/Storage)
├── render-sow-pdf      ← @react-pdf, Storage write
├── push-to-clickup     ← ClickUp API, atomic project creation
└── sync-clickup-actuals ← scheduled, service_role
│
Postgres (RLS = authenticated_all, single-login)
├── Core catalogue:   departments, rules, services, process_steps
├── Intake pipeline:  clients, briefs, scopes
├── Quoting:          quotes, quote_services
├── Projects:         projects, project_actuals
├── Config:           settings, list_aliases
└── Views:            service_allocation_resolved, service_totals
```

Key structural changes vs current:

1. **Feature folders co-locate the component, hook, and any feature-specific lib** rather than separating all components into `/components` and all hooks into `/hooks`. This reduces cross-cutting imports as each aggregate grows.

2. **`QuoteBuilderWorkflow` extracted from `ProjectBuilder`** — a custom hook that owns the auto-create, hydrate, save, and finalise sequence. The page component becomes a layout + event wiring only.

3. **`master-sows.json` moves to Supabase Storage or a DB table.** `draft-sow` reads it server-side. The browser no longer ships or forwards SOW templates.

4. **`AuthContext` replaces per-component `useAuth` calls.** Single subscription, propagated via context.

5. **`resumeHref` and `STATUS_LABEL` moved to `src/lib/brief-routing.ts`** — used by both Inbox and Projects without duplication.

The current architecture is not far from this. The main move is extracting the workflow orchestration out of the two large pages and fixing the master-sows.json round-trip.
