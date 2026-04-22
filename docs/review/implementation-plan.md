# cc-service-calculator — Consolidated Rebuild Plan

**Date:** 2026-04-22
**Synthesised from:** db-findings.md, react-perf-findings.md, architecture-findings.md, modularity-findings.md
**Goal:** Restructure the app so it reads as if it were written greenfield today, without a full rewrite.

The four specialists converged on the same handful of root causes. This plan groups their findings by **dependency order** — fix data-shape and correctness before structural refactors, before performance polish, before cosmetic cleanup. Each item cites which specialist surfaced it.

---

## Phase 0 — Safety & correctness (do first, in this order)

These are the items where leaving things alone risks data loss, security exposure, or permanent broken state. None are large changes.

| # | Severity | Item | Source |
|---|----------|------|--------|
| 0.1 | **H** | **Rotate the publishable key committed in `supabase/migrations/0011_cron_sync_actuals.sql:32`.** It's anon-only, not service-role, but it's in git history and is callable against the `--no-verify-jwt` cron endpoint. Replace the literal with `current_setting('app.anon_key', true)` so re-runs don't re-embed. | db |
| 0.2 | **H** | **Make `push-to-clickup` atomic.** Currently inserts the `projects` row first, then loops ClickUp child-task creation; a mid-loop failure leaves the quote permanently un-pushable on the `projects.quote_id` unique constraint. Either insert `projects` last after all ClickUp calls succeed, or add a `clickup_push_status pending\|complete\|failed` column and finalise it only on success. | db |
| 0.3 | **H** | **Stop overwriting `project_actuals` history.** The cron upserts in place, destroying every prior data point. The burn chart can't render a curve from a single snapshot. Convert `project_actuals` to append-only with a `recorded_at timestamptz default now()` and update queries to read `distinct on (clickup_task_id) order by recorded_at desc`. | db |
| 0.4 | **M** | **Resolve missing migration `0002`.** Live-check `select * from supabase_migrations.schema_migrations` to see whether 0002 was applied. If yes, recreate as a no-op file with a comment explaining what it did; if no, add a placeholder so the gap is intentional and visible. | db, arch |
| 0.5 | **M** | **Enable RLS on `list_aliases` and `list_alias_overrides`** (migration 0009 forgot to). Apply the same `for all to authenticated using (true)` policy used everywhere else, for consistency. | db |
| 0.6 | **M** | **Add storage policies to `brief-attachments` and `quote-pdfs` buckets.** Currently any authenticated user can list every PDF. Acceptable today, blocking when multi-user lands. | db |

---

## Phase 1 — Data model fixes (schema before app changes)

The shape of the DB drives the shape of the hooks and pages above it. Fix here first so refactors above don't bake in workarounds.

| # | Severity | Item | Source |
|---|----------|------|--------|
| 1.1 | **H** | **Add `projects.name`** (denormalised from brief subject at insert time, or via a view). The Projects list currently renders raw ClickUp task IDs because the human name lives four joins away in `briefs.raw_subject`. | arch |
| 1.2 | **M** | **Drop `service_allocation_overrides`** (deprecated since migration 0003 but still queried by `useService`). Remove the table, the fetch in `useServices.ts:71-74`, and the `overrides` field on `ServiceWithTotals`. | db, modularity |
| 1.3 | **M** | **Normalise `quotes.line_items_jsonb` into `quote_line_item_allocations`** with FKs to `services` and `departments`. Keep a `version` field inside the snapshot for forward-compat. The current opaque JSONB blocks any reporting and silently drifts from the `SnapshotLineItem` type declared inside `push-to-clickup`. | db, arch |
| 1.4 | **M** | **Normalise `quote_services.hours_override` and `allocation_override`** (both untyped JSONB) into a `quote_service_overrides (quote_service_id, dept_id, hours_override, pct_override)` table with real FKs and check constraints. Remove `Number(r.pct ?? 0)` silent-zero fallbacks at `ProjectBuilder.tsx:297`. | db, arch |
| 1.5 | **M** | **Move integration secrets out of the `settings` table.** `settings.clickup_pat` and `settings.xero_oauth_tokens` should become Supabase edge-function secrets. Leave `settings` for non-sensitive config only (sync cadence, model name, feature flags). | db |
| 1.6 | **M** | **Wire `settings.burn_sync_cron_minutes` to `cron.alter_job`** via a trigger, OR remove the column entirely. Today the UI lets you change it and silently does nothing — pick one. | db |
| 1.7 | **L** | Apply `tg_touch_updated_at` to `projects` and `contacts`; add `updated_at` to `contacts` for consistency with every other mutable table. | db |
| 1.8 | **L** | Replace `scopes.locked_by` and `briefs.triaged_by` `text` columns with `uuid references team_members(id) on delete set null`. | db |
| 1.9 | **L** | Add partial index `projects_status_idx on projects (status) where status = 'in_progress'` (cron sync queries this every 30 min). | db |
| 1.10 | **L** | Standardise money columns on `bigint` (some are `int`, some `bigint`); document the choice in a schema comment. | db |

---

## Phase 2 — Structural refactor (architecture & modularity)

Extract workflows out of pages, fix layering bypasses, and consolidate duplicated logic. These are the changes that most directly answer "as if it were written for the first time".

### 2.1 — Reorganise into feature folders

Adopt the structure proposed by the architecture specialist:

```
src/
├── pages/        ← display + event wiring only, no orchestration
├── features/     ← one folder per domain aggregate
│   ├── briefs/   ← BriefRow, useBriefs, brief-routing.ts
│   ├── scopes/
│   ├── quotes/   ← QuoteLineEditor, useQuotes, useQuoteBuilder workflow hook
│   ├── projects/
│   └── services/ ← ServicePicker, AllocationEditor, useServices (CRUD only)
├── lib/          ← pure functions (current shape is good, leave alone)
├── hooks/        ← thin Supabase wrappers; no business logic
└── context/      ← AuthContext (single session subscription)
```

Import direction rule: `types/db → lib → hooks → components → pages`. No upward imports.

### 2.2 — Extract `useQuoteBuilder` workflow hook from ProjectBuilder.tsx

ProjectBuilder.tsx (582 lines) is flagged by all three non-DB specialists. It auto-creates quotes on mount, hydrates editor state, calls two edge functions, finalises, and renders PDFs. Extract:

- A `useQuoteBuilder(scopeId)` hook owning the auto-create / hydrate / save / finalise sequence
- `ProgressStepper` and `ScopeSidebar` sub-components (currently defined inline) → `src/features/quotes/`
- The manual `supabase.from("quote_services")` fetch at lines 249–263 → into the existing `useQuote` hook (eliminates the 3-hop waterfall flagged by perf)

### 2.3 — Split `useServices.ts` (243 lines, three concerns)

- Keep CRUD in `useServices.ts`
- Move `useSetServiceChecklist` → `useProcessSteps.ts` (where it actually writes)
- Move `useAllocationMatrix` → `useAllocationMatrix.ts` (cross-entity aggregate, not a service query)

### 2.4 — Stop bypassing the hooks layer

These four sites call `supabase.from()` directly, leaving stale cache:

- `src/components/ProcessFlow.tsx` — `seedFromChildren()` raw query
- `src/components/SaveAsRuleModal.tsx` — direct `rules` / `rule_allocations` writes
- `src/pages/NewBrief.tsx` — direct `briefs.update` for attachments
- `src/pages/QuoteSend.tsx` — direct `scopes.select` in useEffect

Route each through the existing hook (or add a hook if missing). The point of the hooks layer is the cache contract.

### 2.5 — Move `master-sows.json` server-side

Today it's imported in `ProjectBuilder.tsx`, shipped to the browser (~80 KB), then forwarded as a POST body to `draft-sow`. Move to a `master_sows` DB table or a Storage object the edge function reads directly.

### 2.6 — Add `supabase/functions/_shared/`

Eliminate the duplicated `json()` / `cors()` / Supabase-client-init across all 7 edge functions:

- `_shared/helpers.ts` — `json(body, status)`, `cors()`
- `_shared/supabase-client.ts` — auth-forwarding factory
- `_shared/anthropic.ts` — fetch wrapper used by the 4 AI functions
- `_shared/clickup.ts` — `buildBriefComment`, `resolveListAlias` (real home for the dead `src/lib/clickup-shared.ts` logic)

After this, delete `src/lib/clickup-shared.ts` (or leave a thin re-export with a comment) and replace the inlined `BRIEF::` comment in `push-to-clickup/index.ts:175` with the shared helper.

### 2.7 — Consolidate duplications

- `99.5` / `100.5` literals in `QuoteLineEditor.tsx:31` and `AllocationEditor.tsx:115` → import `SUM_TOLERANCE_MIN/MAX` from `lib/allocation.ts`
- `resumeHref()` and `STATUS_LABEL` duplicated in `Inbox.tsx` and `Projects.tsx` → `src/lib/brief-routing.ts`

### 2.8 — `AuthContext`

Replace per-component `useAuth()` and `useCurrentUserName()` calls with a single `AuthContext` provider. Removes the per-call `supabase.auth.onAuthStateChange` and `getSession` subscriptions.

### 2.9 — Parallelise the ClickUp child-task loop in `push-to-clickup`

Current loop is sequential (`await fetch` per allocation). Group with `Promise.allSettled` in batches of 5 to stay under the 100/min ClickUp rate limit. Pairs naturally with 0.2 (atomic push). Same for the N+1 in `sync-clickup-actuals` — fetch all `project_actuals` for all in-progress projects in one query.

### 2.10 — Read `anthropic_model` from settings everywhere

`generate-process-steps` hardcodes the model; the other three AI edge functions read from `settings.anthropic_model`. Make all four consistent.

---

## Phase 3 — Performance polish

After the structural work, the perf wins are mostly small and surgical. **3.1 is the single highest-impact change in the entire plan** for user-perceived load time.

| # | Item | Effort | Source |
|---|------|--------|--------|
| 3.1 | **Route-level code-splitting with `React.lazy` + `Suspense`.** Bundle is currently 1.94 MB / 617 KB gzip in a single chunk. At minimum lazy-load `Scope` (`@uiw/react-md-editor` ~80 KB gzip) and `ProjectBuilder` / `QuoteSend` (`@react-pdf/renderer` ~120 KB gzip if client-side). | M | perf |
| 3.2 | **Virtualise `ServicesList`.** ~140 rows × 8+ controlled department inputs is the heaviest DOM in the app. Use `@tanstack/virtual` (sibling of the already-installed `@tanstack/react-table`). | M | perf |
| 3.3 | **Add `staleTime` everywhere.** Zero `staleTime` on any hook means every window-focus refetches everything in parallel. `5 * 60 * 1000` for stable data (`useDepartments`, `useRules`, `useTeam`, `useServices`, `useClients`); `30_000` for `useBriefs`/`useQuotes`. | S | perf |
| 3.4 | **Memoise `ServiceRow`** in ServicesList (currently re-renders all 140 rows on every search keystroke) and lift `useSetServiceChecklist` up to the parent. | S | perf |
| 3.5 | `useMemo` for `clientById` Map in `Inbox.tsx:79` and `Projects.tsx:43`; for `totals` in `ProjectBuilder.tsx:281`. | XS | perf |
| 3.6 | **Consolidate the 4 `useBriefs` calls in Inbox** to one query, group client-side. | S | perf |
| 3.7 | Parallelise the two serial Supabase calls in `useServices` (`Promise.all`). | XS | perf |
| 3.8 | Fix `useEffect` dep in `ServiceDetail` to depend on `detail?.service?.id` not the whole `detail` object (currently re-runs `setForm` on every refetch). | XS | perf |
| 3.9 | Stabilise `useAllocationMatrix` return identity — return plain objects keyed by id instead of `Map`s, OR use `select` to memoise. New `Map` identity on every fetch cascades re-renders. | S | perf |
| 3.10 | Replace the `setTimeout`-based ordinal swap in `ProcessFlow.tsx:110` with a single batched mutation or RPC. | S | perf, modularity |

---

## Phase 4 — Cleanup

Once the above is done:

- Delete `src/lib/clickup-shared.ts` (now lives in `_shared/`)
- Drop `service_allocation_overrides` table (covered by 1.2)
- Add tests at the boundaries that currently have none: `push-to-clickup` (atomic project creation), `useQuoteBuilder` (workflow), `sync-clickup-actuals` (history append)
- Make `scripts/import-csv.ts` idempotent (currently dupes on re-run)
- Document the `0002` migration gap (or fill it) — covered by 0.4
- Replace `useCurrentUserName` stub once `AuthContext` lands (2.8)

---

## Suggested execution order

The phases above are also the suggested order. Within Phase 0, do **0.1 first** (key rotation is a 5-minute task and stops the clock on exposure). Do **0.3 before** anyone trusts the burn chart again.

Phase 1 (schema) before Phase 2 (app refactor) so the refactor doesn't bake in workarounds for things that are about to be normalised.

Phase 2 before Phase 3 because most of the perf wins land more cleanly on top of the new structure (e.g., 3.1 route-splitting is trivial once 2.1 feature folders exist; 3.4 memoisation is trivial once 2.3 splits `useServices`).

Phase 4 is cleanup that should happen continuously, not a discrete step.

---

## What the plan does NOT do

- Does not change the stack (Vite/React/Supabase stays).
- Does not change the routing library (React Router v7 stays — TanStack Router would be a Phase 5+ exploration).
- Does not introduce new external services.
- Does not touch the design-token / Figma-sync system (already clean).
- Does not add multi-user auth (out of scope for V1 per CLAUDE.md). Items marked "becomes critical when multi-user lands" are flagged but not scheduled.

---

## Execution summary (rebuild branch `rebuild/phases-0-to-4`)

**Phase 0 — Safety (3/3 tasks complete)**
- T1 → migration 0012 (commits `145dd90`, `c54aaf4`)
- T2 → migration 0013 + sync-clickup-actuals append-only (commits `e22a2cc`, `f642e5b`)
- T3 → push-to-clickup atomicity + parallelization + sync N+1 fix (commits `4847437`, `9071e0b`)

**Phase 1 — Data model (6/6 tasks complete)**
- T4 → migration 0014 (commit `efe26e1`)
- T5 → migration 0015 (commit `99e05b0`)
- T6 → migration 0016 (commit `29c60fd`)
- T7 → migration 0017 (commit `fbf25bc`)
- T8 → migration 0018 + normalize quote_services overrides (commits `2e242ab`, `3ba6b2a`)
- T9 → migration 0019 + normalize line_items_jsonb (commit `c87edd3`)

**Phase 2 — Structural (8/8 tasks complete)**
- T10 → supabase/functions/_shared/ scaffold (commit `078fe34`)
- T11 → migrate all 7 edge functions; delete clickup-shared (commit `7b70a28`)
- T12 → migration 0020; master-sows server-side (commit `0279fce`)
- T13 → AuthContext + brief-routing + tolerance constants (commit `efafe4b`)
- T14 → split useServices.ts (commit `a37e8c1`)
- T15 → fix hooks-bypass sites (commit `39cadb0`)
- T16 → extract useQuoteBuilder; ProjectBuilder 577 → 172 lines (commit `36cc48b`)

**Phase 3 — Performance (3/3 tasks complete)**
- T17 → route-level code splitting; main chunk 617 KB → 149 KB gzip (commit `f5b2d55`)
- T18 → memoize ServiceRow + lift mutation; virtualization deferred (commit `378a5c9`)
- T19 → hot-path memoization cluster (commit `325c32d`)

**Phase 4 — Cleanup**
- T20 → user-action items + stale script ref + plan reconciliation (this commit)

**Headline metrics**
- Bundle: 1936 KB raw / 617 KB gzip → 507 KB raw / 149 KB gzip main chunk (76% reduction)
- ProjectBuilder.tsx: 577 lines → 172 lines (70% reduction)
- 9 new migrations (0012–0020) all idempotent on re-apply
- 7 edge functions consolidated onto a `_shared/` module set
- 4 hooks-layer bypass sites eliminated
- Test count: 28 vitest + 9 Deno (covers pure-function lib + shared helpers)
- All 28 vitest tests pass; typecheck and build clean throughout
