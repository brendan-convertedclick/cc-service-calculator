# Modularity Review — cc-service-calculator

## Summary (top 5 issues)

1. **`useServices.ts` does three unrelated jobs** — CRUD for services, checklist mutation logic, and the global allocation matrix query. These are consumed by different parts of the app and should be separate modules.
2. **Tolerance magic numbers duplicated** — `99.5` / `100.5` are literal in `QuoteLineEditor.tsx:31` and `AllocationEditor.tsx:115` despite being exported as `SUM_TOLERANCE_MIN/MAX` from `lib/allocation.ts`. Two files ignore the constants they could import.
3. **`clickup-shared.ts` is dead to the edge functions** — the module exists in `src/lib/` and claims to be shared with `push-to-clickup`, but that function re-implements the `buildBriefComment` logic inline and never imports `clickup-shared`. The library is used only in its own test file.
4. **Every edge function re-declares `json()` + `cors()`** — five of the seven functions contain identical `json()` and `cors()` helper functions. No shared module exists in `supabase/functions/`.
5. **`SaveAsRuleModal` and `ProcessFlow` bypass the `useRules`/`useCreateRule` hooks** by calling `supabase.from(...)` directly, breaking the cache invalidation contract established by the hooks layer.

---

## Import Graph Findings

### Hub modules (many inbound, few outbound — stable, good)

| Module | Inbound imports | Outbound |
|---|---|---|
| `src/lib/supabase.ts` | 14 hooks + 5 pages + 3 components | 2 (supabase-js, types/db) |
| `src/lib/utils.ts` (cn, formatZar, formatHours) | 12 files | 2 (clsx, tailwind-merge) |
| `src/types/db.ts` | 14 hooks + 3 components | 0 |
| `src/lib/allocation.ts` | 4 files | 0 |

These are healthy stable-abstraction hubs. `supabase.ts` and `types/db.ts` sit at the base of the dependency tree as expected.

### Smell: components importing `supabase` directly (bypassing hooks)

- `src/components/ProcessFlow.tsx` — calls `supabase.from("service_allocation_resolved")` inside `seedFromChildren()` and `supabase.functions.invoke("generate-process-steps")`
- `src/components/SaveAsRuleModal.tsx` — calls `supabase.from("rules")` and `supabase.from("rule_allocations")` directly, duplicating the mutation logic in `useCreateRule` / `useUpdateRule`
- `src/pages/NewBrief.tsx` — calls `supabase.from("briefs").update(...)` directly for attachment handling, outside `useUpdateBrief`
- `src/pages/QuoteSend.tsx` — calls `supabase.from("scopes").select(...)` inside a `useEffect`, bypassing `useScopes`

The hooks layer exists to centralise query keys and cache invalidation. Bypass calls leave stale cache entries.

### Pages that import `supabase` directly (edge function invocations — acceptable)

`ProjectBuilder`, `Scope`, `QuoteDetail` each call `supabase.functions.invoke(...)` inline. Edge function calls are imperative (fire-and-read-result) so a hook wrapper isn't strictly needed, but the response-parsing and loading-state logic is duplicated across three files.

---

## Cohesion Issues

### `src/hooks/useServices.ts` (243 lines — three distinct concerns)

1. **Service CRUD** — `useServices`, `useService`, `useCreateService`, `useUpdateService`, `useDeleteService` — standard resource hooks.
2. **Checklist mutation** — `useSetServiceChecklist` (70 lines). This is a domain operation that writes to `process_steps`, not a service CRUD operation. It belongs in `useProcessSteps.ts` alongside `useReplaceSteps`.
3. **Allocation matrix query** — `useAllocationMatrix` (45 lines). Reads `service_allocation_resolved`, `process_steps`, and `service_children` in one shot. It is a cross-entity aggregate view, not a service query. It could live in a new `useAllocationMatrix.ts` or alongside `useScopes.ts` as it feeds the same "computed view" concern.

Proposed split:
- `src/hooks/useServices.ts` — CRUD only (lines 1–118 + `ServiceWithTotals` type)
- Move `useSetServiceChecklist` → `src/hooks/useProcessSteps.ts`
- Move `useAllocationMatrix` → `src/hooks/useAllocationMatrix.ts`

### `src/components/ProcessFlow.tsx` (374 lines — component + data access + business logic)

Contains:
- The step list UI
- Inline `generateAI()` that invokes the edge function and parses the response
- `seedFromRule()` — implements hours-from-allocation math (duplicates logic in `lib/allocation.ts`)
- `seedFromChildren()` — performs a raw Supabase query inside an async IIFE
- `moveStep()` — two-stage ordinal swap using `setTimeout` (a fragile workaround)

At minimum, `generateAI`, `seedFromChildren` (the Supabase call), and the timeout-based swap in `moveStep` should be encapsulated in `useProcessSteps.ts` mutations.

### `src/pages/ProjectBuilder.tsx` (582 lines — page + 4 sub-components + orchestration)

Contains four internal component definitions (`ProgressStepper`, `ScopeSidebar`, `EmptyLines`, `SOWPanel`) plus complex orchestration logic for quote creation, AI suggestion, SOW drafting, and finalisation. The sub-components should be extracted to `src/components/` (at minimum `ProgressStepper` and `ScopeSidebar` are reusable). The orchestration logic (`aiSuggest`, `draftSow`, `finalise`, `saveLines`) could be extracted to a `useProjectBuilder` hook to make the page component a thin shell.

---

## Duplication

### Allocation tolerance bounds

`lib/allocation.ts` exports `SUM_TOLERANCE_MIN = 99.5` and `SUM_TOLERANCE_MAX = 100.5`.

- `src/components/QuoteLineEditor.tsx:31` — `sumPct < 99.5 || sumPct > 100.5` (hardcoded)
- `src/components/AllocationEditor.tsx:115` — `"must be between 99.5 and 100.5"` (hardcoded in string)

Both should import and use the exported constants.

### `json()` + `cors()` helpers in every edge function

All five AI/ClickUp edge functions (`draft-scope`, `draft-sow`, `suggest-services`, `generate-process-steps`, `render-sow-pdf`, `push-to-clickup`) define identical or near-identical `json()` and `cors()` helpers. The only variation is the function name (`cors` vs `corsHeaders`).

Proposed: create `supabase/functions/_shared/helpers.ts` exporting `json()` and `cors()`. Deno supports relative imports across function directories.

### `buildBriefComment` duplicated

`src/lib/clickup-shared.ts:55` defines `buildBriefComment(p)` → `BRIEF:: ${JSON.stringify(p)}`.

`supabase/functions/push-to-clickup/index.ts:175` inlines the same logic:
```
comment_text: `BRIEF:: ${JSON.stringify({ ... })}`,
```

`push-to-clickup` never imports `clickup-shared`. The shared module's stated purpose (comment in file header) is not fulfilled. Either the edge function should import from `_shared/clickup-helpers.ts` (if Deno import works), or the comment in `clickup-shared.ts` that says "Phase 3 will collapse the duplication" should be treated as a known debt item.

### Supabase client initialisation pattern

Every edge function initialises the Supabase client inline with the same three-line pattern. A `supabase/functions/_shared/client.ts` could export a factory to reduce boilerplate and ensure the auth header is always forwarded.

---

## Component & Hook API Consistency

### Hook return shapes — mostly consistent, one outlier

The majority of data hooks follow `useQuery` / `useMutation` from TanStack Query and return the raw `UseQueryResult` or `UseMutationResult`. That's consistent. The exception:

- `useCurrentUserName()` — returns a plain `string`, not a query result. It is a stub (hardcoded `"Brendan"`). When real auth lands, callers expecting a bare string will need updating. At minimum, the return type should signal its stubbed nature; alternatively, model it as `{ name: string; isStub: boolean }` so callers can adapt.

### Mutation argument shapes

Most mutations take `{ id, patch }` objects (good) but `useUpdateBrief` automatically merges `updated_at` into the patch, while `useUpdateQuote` does the same. This is a hidden side-effect in the hook contract not documented in the type signature — callers passing `updated_at` themselves would get it silently overwritten.

---

## Edge Function Code-Sharing

### What exists

`supabase/functions/` has no `_shared/` directory. Each function is fully self-contained.

### What should be extracted

| Candidate | Used by |
|---|---|
| `json(body, status)` helper | all 7 functions |
| `cors()` / `corsHeaders()` helper | all 7 functions |
| Supabase client factory (init with auth header forwarding) | draft-scope, draft-sow, suggest-services, generate-process-steps, push-to-clickup, render-sow-pdf |
| `buildBriefComment()` | push-to-clickup (currently inlined) |
| Anthropic fetch wrapper | draft-scope, draft-sow, suggest-services, generate-process-steps |

### `clickup-shared.ts` situation

`src/lib/clickup-shared.ts` is tested in isolation and its logic is correct, but it is never consumed by the edge function it was designed for. Options:
1. Move it to `supabase/functions/_shared/clickup-helpers.ts` and import it from `push-to-clickup` (requires Deno relative import compatibility).
2. Keep it in `src/lib/` for any future client-side preview UI but acknowledge it does not share with the server.

Currently it is only used in its own test file — it is effectively dead to production code.

---

## Dead Code

### `clickup-shared.ts` — zero production callers

`src/lib/clickup-shared.ts` exports `resolveListAlias` and `buildBriefComment`. Neither is imported anywhere in `src/` except the test file. The module is not imported in any edge function. It exists only for its tests.

Action: either wire it up (move to `_shared/`) or add a comment marking it as pre-wired for Phase 3.

### `useCurrentUserName` stub

`src/hooks/useCurrentUserName.ts` returns `"Brendan"` unconditionally. The file comment says to swap the implementation when auth lands. This is intentional placeholder code, not dead code — but it is a named hook file that exports nothing query-shaped, which could confuse a new developer.

### `ProgressStepper` component

Defined inside `ProjectBuilder.tsx` (line 36). It is only used once (line 430 in the same file). It is not dead but it is not discoverable or reusable in its current location.

---

## Proposed Module Structure

If reorganised greenfield, the import direction rule would be:

```
types/db → lib/* → hooks/* → components/* → pages/*
```

**`src/lib/`** — pure functions, no React, no Supabase client. Importable by both frontend and (if transpiled) edge functions.
- `allocation.ts` — sum/validate/resolve allocation math (current, keep)
- `quotes.ts` — aggregate totals, build snapshot (current, keep)
- `scope-overlap.ts` — Jaccard similarity (current, keep)
- `mailto.ts` — URL builder (current, keep)
- `clickup-shared.ts` — rename to `clickup.ts` or delete/migrate to `_shared/`
- `utils.ts` — `cn`, `formatZar`, `formatHours` (keep; small and stable)

**`src/hooks/`** — one file per entity resource + one file per complex computed query
- `useServices.ts` — CRUD only (split from current)
- `useProcessSteps.ts` — step CRUD + `useSetServiceChecklist` (merge)
- `useAllocationMatrix.ts` — new, extracted from `useServices.ts`
- Remaining hooks unchanged (each already maps 1:1 to a DB table)

**`src/components/`** — presentational + self-contained smart components
- Extract from `ProjectBuilder.tsx`: `ProgressStepper.tsx`, `ScopeSidebar.tsx`
- `SaveAsRuleModal.tsx` — replace direct `supabase.from()` calls with `useCreateRule`/`useUpdateRule` hooks

**`supabase/functions/_shared/`** — Deno-importable edge function utilities
- `helpers.ts` — `json()`, `cors()`
- `supabase-client.ts` — Supabase client factory
- `anthropic.ts` — Anthropic fetch wrapper
- `clickup.ts` — `buildBriefComment`, `resolveListAlias`
