# React Performance Findings

## Summary (top 5 issues by user-visible impact)

1. **No code-splitting — entire app is one 1.9 MB JS chunk.** Every route, including `@react-pdf/renderer` and `@uiw/react-md-editor`, loads on the first paint. Gzipped it is 617 KB over the wire. The two heavy deps alone likely account for 300–400 KB gzipped.

2. **`useSetServiceChecklist` called inside every `ServiceRow` render.** `ServiceRow` is not memoized and re-renders for every row on every keystroke in the search box. Each render calls `useSetServiceChecklist()` which calls `useQueryClient()` — low overhead per call, but it also means the `isPending` status from the last mutation is tracked per-row rather than per-table, causing subtly wrong disabled states when saving a different row.

3. **`clientById` Map reconstructed on every render in `Inbox` and `Projects`.** `src/pages/Inbox.tsx:79` and `src/pages/Projects.tsx:43` both do `new Map(clients.map(...))` inline in the component body with no `useMemo`. Every render (including the four `useBriefs` re-renders on load) rebuilds this map.

4. **Waterfall in `ProjectBuilder` hydration.** On mount: wait for `scope` → then `createQuote` fires → wait for `liveQuote` → then a manual `supabase.from("quote_services")` fetch runs sequentially (`src/pages/ProjectBuilder.tsx:249`). This is a 3-hop serial waterfall before lines render, all done outside TanStack Query so it has no caching, deduplication, or background refetch.

5. **`useServices` makes two serial Supabase calls** (`services` then `service_totals`) instead of one, and there is no `staleTime` on any query across the entire codebase, meaning every navigation triggers a background refetch of all queries simultaneously.

---

## Query layer issues

### `src/hooks/useServices.ts`

- **Lines 26–32:** `useServices` fetches `services` first, then awaits `service_totals` — serial. Switch to `Promise.all` to run in parallel (same pattern as `useAllocationMatrix` on line 207).
- **No `staleTime` anywhere** in this file (or any hook file). With zero `staleTime`, every window focus and route change refetches everything. For static-ish data like `services`, `departments`, `rules`, `team`, a `staleTime: 5 * 60 * 1000` is appropriate. Briefs and quotes change more often but still benefit from `staleTime: 30_000`.
- **`useAllocationMatrix` returns `Map` objects (lines 220, 233, 236).** TanStack Query uses structural equality by default for `select`, but since the query function always returns `new Map(...)`, every fetch triggers downstream re-renders in all subscribers even if the underlying data is unchanged. Consider either (a) returning a plain object keyed by id, or (b) using `select` to transform and stabilise the shape.

### `src/hooks/useBriefs.ts`

- **Lines 74–77 in `Inbox.tsx`:** Four separate `useBriefs` calls fire four concurrent queries with four different cache keys (`["briefs","new"]`, `["briefs","needs_info"]`, `["briefs","triaged,scoped,quoted"]`, `["briefs","accepted,rejected,archived,spam"]`). This means four round trips on every Inbox mount. A single `useBriefs()` (no filter) with client-side grouping would cut this to one query, and the data is already small enough that JS filtering is negligible.
- **`useUpdateBrief` invalidates `["briefs"]` (line 64)** — this is a prefix match and will bust all four Inbox query keys simultaneously, causing four re-fetches. That is correct behaviour but re-enforces the above point that a single query would be cleaner.

### `src/hooks/useQuotes.ts`

- **`useQuote` (lines 20–22):** Uses `Promise.all` — good, no waterfall here.
- **`useLiveQuoteForScope`** is fine; narrow query with `.limit(1)`.

### `src/hooks/useRules.ts` (not shown but implied)

- **`useRules` likely fetches `rules` + `rule_allocations` in sequence** given the pattern seen elsewhere. Should verify and parallelise.

---

## Re-render hotspots

### `src/pages/ServicesList.tsx:143` — `useSetServiceChecklist` in `ServiceRow`

`ServiceRow` is an unexported function component with no `React.memo`. It is rendered once per service (up to ~140 rows per the CLAUDE.md). Every character typed in the search box causes `ServicesList` to re-render, which re-renders all visible `ServiceRow` components. Each `ServiceRow` calls `useSetServiceChecklist()` on every re-render. Fix: wrap `ServiceRow` in `React.memo` and move `useSetServiceChecklist` up to `ServicesList`, passing `mutate`/`isPending` as props (or accept the one-mutation-shared model).

### `src/pages/Inbox.tsx:79` and `src/pages/Projects.tsx:43` — inline `new Map`

```tsx
// Inbox.tsx:79 — recreated on every render
const clientById = new Map(clients.map((c) => [c.id, c.name]));
```

Wrap in `useMemo(() => new Map(...), [clients])`. Same pattern in `Projects.tsx:43`.

### `src/pages/ProjectBuilder.tsx:469–495` — inline `onChange`/`onRemove` closures

Every `QuoteLineEditor` receives a new `onChange` and `onRemove` function reference on every `lines` state update (lines 478–494). Since `QuoteLineEditor` is not memoized, this does not cause extra renders today — but if it were ever wrapped in `memo`, these would defeat it. Wrapping each in `useCallback` with `[i, lines]` deps, or using the functional updater pattern (already used on line 479) and stabilising with `useCallback`, would be the right preparation.

### `src/pages/ProjectBuilder.tsx:281` — `aggregateTotals` called bare in render

```tsx
const totals = aggregateTotals(lineTotals, { margin_pct: marginPct, discount_room_pct: discountPct });
```

`lineTotals` is memoized (line 267) but `totals` is not. Any state change (e.g., typing in the Discount % input) re-runs `aggregateTotals`. Wrap in `useMemo` with `[lineTotals, marginPct, discountPct]`.

### `src/components/ProcessFlow.tsx:110` — `setTimeout` for step reordering

```tsx
update.mutate({ id: a.id, patch: { ordinal: b.ordinal + 10000 } });
setTimeout(() => {
  update.mutate({ id: b.id, patch: { ordinal: a.ordinal } });
  update.mutate({ id: a.id, patch: { ordinal: b.ordinal } });
}, 50);
```

Three separate mutation calls with a raw `setTimeout`. Each fires an invalidation of `["process_steps", serviceId]`, causing up to three re-fetches. Use `Promise.all` or a single batch RPC call. The 50 ms timeout is also a race condition with slow networks.

### `src/pages/ServiceDetail.tsx:68` — `useEffect` on `detail` (not `detail?.service`)

```tsx
useEffect(() => {
  if (detail?.service) { setForm(...) }
}, [detail]);
```

`useService` returns `{ service, resolved, overrides }`. `detail` identity changes on every fetch even if the service hasn't changed (because the object is new). The `setForm` call will re-run any time `resolved` or `overrides` are refetched. Depend on `detail?.service` or use a stable ID check.

---

## Bundle & code-splitting

**Single chunk: 1,937 KB (617 KB gzip).**  No `React.lazy`, no `import()`, no `Suspense` anywhere in the codebase.

Heavy deps identified:

| Dep | Approx. gzip | Used on |
|-----|-------------|---------|
| `@react-pdf/renderer` | ~120 KB | `render-sow-pdf` edge fn only — but it is also imported client-side via `SOWPreview`/`SOWPanel`? Verify. |
| `@uiw/react-md-editor` | ~80 KB | `src/components/ScopeEditor.tsx` only (Scope page) |
| `@tanstack/react-table` | ~15 KB | ProjectDetail |

`@uiw/react-md-editor` is only used in `ScopeEditor` which is only used on `Scope` page. Lazy-load the entire `Scope` route:

```tsx
const Scope = React.lazy(() => import("./pages/Scope"));
// wrap in <Suspense fallback={<div>Loading…</div>}>
```

Same for `ProjectDetail` if it imports `@tanstack/react-table`. Check whether `@react-pdf/renderer` is actually imported client-side or only in the edge function — if client-side, lazy-load `QuoteSend`.

---

## List/virtualization

- **`ServicesList`** renders all filtered rows as a flat `<tbody>`. With ~140 services (CLAUDE.md) and no virtualization, initial paint dumps 140 `<ServiceRow>` components each containing N department `<input>` elements. At ~8 departments, that is ~1,120 controlled inputs. This is the most expensive initial render in the app.
  - Quick fix: pagination or a client-side slice (show 50, "load more").
  - Better fix: `@tanstack/virtual` row virtualization.
- **`Inbox`/`Projects`/`Rules`** lists are small enough (dozens of items) that virtualization is not needed.
- **Keys are all stable IDs** — no index keys observed. Good.

---

## Forms

- **`ServiceDetail`** uses `useState` + `setForm({ ...form, field: value })` — a single large state object. Every keystroke replaces the entire object, causing the whole form to re-render. This is fine for a small internal tool but could be replaced with `useReducer` or RHF if the form grows. Not a high-priority issue.
- **`ProcessFlow` inputs use `defaultValue` + `onBlur`** (lines 292, 299, 328). This is the correct uncontrolled pattern — saves only on blur, no per-keystroke renders. Good.
- **`QuoteLineEditor`** allocation inputs are controlled (`value={pct}` line 189) and call `onChange` on every change. Since allocation changes propagate up to `ProjectBuilder.lines` state and re-render all `QuoteLineEditor` rows, editing one department field re-renders all other rows. `React.memo` on `QuoteLineEditor` would isolate this (each row only changes when its own `line` prop changes).
- No RHF is used; no Zod resolvers running on keystrokes. No issue there.

---

## Quick wins

1. **`useMemo` for `clientById`** in `Inbox.tsx:79` and `Projects.tsx:43` — 2-line change each.
2. **`useMemo` for `totals`** in `ProjectBuilder.tsx:281` — 1-line change.
3. **`staleTime: 5 * 60 * 1000`** on `useDepartments`, `useRules`, `useTeam`, `useServices`, `useClients` — these change rarely and refetching on every focus is wasteful. Add to each query definition.
4. **Parallelise `useServices` fetches** (lines 26–32): wrap the two supabase calls in `Promise.all`.
5. **Fix `useEffect` dep in `ServiceDetail`** to depend on `detail?.service?.id` rather than the whole `detail` object.
6. **Consolidate `useBriefs` in `Inbox`** from four queries to one, group client-side.

---

## Bigger rewrites

1. **Code-splitting:** Add `React.lazy` + `Suspense` at the route level in `App.tsx`. At minimum lazy-load `Scope` (md-editor), `QuoteSend`/`ProjectBuilder` (pdf renderer if client-side). This is the single highest-impact change for initial load time.

2. **`ServicesList` virtualization:** Replace the flat `<tbody>` dump with `@tanstack/virtual` (the dep is already in `package.json` via `@tanstack/react-table` — virtual is a separate package but same ecosystem). With 140 rows × 8+ department inputs, the current approach is the heaviest DOM in the app.

3. **`ProjectBuilder` quote hydration:** Move the manual `supabase.from("quote_services")` fetch (lines 249–263) into a proper `useQuery` with a stable cache key (e.g., `["quote_services", liveQuote.id]`). This gives it caching, deduplication, and removes the `hydratedForQuote` guard state that is working around the missing cache.

4. **`AllocationMatrix` return type:** Return plain objects instead of `Map`s, or use `select` to stabilise identity. `Map` identity always changes on refetch, cascading re-renders to `ServicesList` (140 rows) and `ProcessFlow` every time the matrix refreshes.
