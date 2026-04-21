# Compound services — design spec

**Date:** 2026-04-21
**Status:** Approved, ready for planning
**Builds on:** `2026-04-21-process-flow-checklist-design.md` (the checklist-as-source-of-truth model)

## Problem

Some services are naturally bundles: "Social media campaign" is really creative production + strategy + community management. Today every service stands alone, so bundling one up means duplicating checklists and keeping them in sync by hand.

We need compound services: a service that includes other services as its scope. The parent keeps its own price (bundle pricing is independent of child prices), but its department-hours allocation derives from the children unless the parent defines its own checklist.

## Decisions (locked via Q&A)

| Decision | Chosen |
|---|---|
| Compound pricing | Independent — parent's `sell_price_cents` is set manually; children describe scope, not price. |
| Parent allocation | Hybrid: default is sum of children's resolved hours per department. If the parent has its own checklist, that overrides. |
| Nesting | Fully recursive — compounds can contain compounds. Cycles prevented by trigger. |
| Quantity per child | Integer, default 1. Multiplies hours and display. |
| Edit surface | Service detail page gains an "Includes these services" card alongside Process flow. |
| Compound flag | Implicit — any service with ≥1 child row is compound. No explicit type column. |
| Grid display | Compounds mix into `/services` table; derived dept cells are read-only (same as "has checklist" state); a "bundle · N" badge appears next to the name. |

## Architecture

Extends the existing three-tier model (checklist → rule) into three tiers (checklist → children → rule). The single shared `service_allocation_resolved` view handles the recursion in Postgres; the client stays simple.

### Precedence for a service's department hours

```
own checklist (process_steps with dept+hours)     ← highest
  ↓ if none
derived from children (recursive sum × quantity)  ← new
  ↓ if none
rule fallback (rule_allocations)                  ← existing
```

A service with its own checklist is always a leaf in the recursion — the view short-circuits at that service. A service without its own checklist but with children walks down; each child resolves via the same three-tier precedence. Quantities multiply through the path.

### Why a DB view (not client-side composition)

The grid, the service detail page, and any future consumer already read `service_allocation_resolved`. Adding recursion in the view keeps them all in sync for free, and cycle detection lives next to the data. Client-side composition would duplicate the logic and drift.

## Data model

### New table: `service_children`

```sql
create table service_children (
  parent_id    uuid not null references services(id) on delete cascade,
  child_id     uuid not null references services(id) on delete restrict,
  ordinal      int  not null,
  quantity     int  not null default 1 check (quantity >= 1),
  created_at   timestamptz not null default now(),
  primary key (parent_id, ordinal),
  unique (parent_id, child_id),
  check (parent_id <> child_id)
);
```

Notes:
- `on delete cascade` on `parent_id` — deleting a compound tears down its child rows cleanly.
- `on delete restrict` on `child_id` — if you try to delete a service that's used as a child somewhere, Postgres refuses. The client surfaces a clear error: "This service is included in N compound services."
- `unique (parent_id, child_id)` — no duplicate child rows; use `quantity` for multiples.
- `check (parent_id <> child_id)` — blocks the trivial self-loop.
- RLS enabled; single `authenticated` policy mirrors every other table.

### Cycle-prevention trigger

`tg_service_children_no_cycle` before insert/update on `service_children`:

```sql
-- walk ancestors of NEW.parent_id; if NEW.child_id appears, raise
with recursive ancestors as (
  select NEW.parent_id as node_id, 0 as depth
  union all
  select sc.parent_id, a.depth + 1
  from service_children sc
  join ancestors a on sc.child_id = a.node_id
  where a.depth < 20
)
select 1 from ancestors where node_id = NEW.child_id;
-- if FOUND, raise exception 'Adding this child would create a cycle'
```

The client also filters the "Add service" dropdown to exclude self and known ancestors — UX guardrail — but the trigger is the real protection.

### View rewrite: `service_allocation_resolved`

```sql
create or replace view service_allocation_resolved as
with recursive
step_sums as (
  select service_id, department_id, sum(estimated_hours) as hours
  from process_steps
  where department_id is not null and estimated_hours is not null
  group by service_id, department_id
),
tree as (
  -- leaf: any service (used as a root). Depth 0.
  select s.id as root_id, s.id as node_id, 1::int as quantity, 0 as depth
  from services s

  union all

  -- walk children of services that have no own checklist
  select t.root_id, sc.child_id, t.quantity * sc.quantity, t.depth + 1
  from tree t
  join service_children sc on sc.parent_id = t.node_id
  where not exists (select 1 from step_sums where service_id = t.node_id)
    and t.depth < 10   -- runaway guard; real protection is the cycle trigger
),
derived as (
  -- sum step hours over the tree for each root, only where the root itself
  -- has no own checklist OR the node is the root (the checklist-owning leaf).
  select t.root_id as service_id, ss.department_id, sum(ss.hours * t.quantity) as hours
  from tree t
  join step_sums ss on ss.service_id = t.node_id
  where not exists (select 1 from step_sums where service_id = t.root_id)
     or t.node_id = t.root_id
  group by t.root_id, ss.department_id
)
-- final: derived rows, unioned with rule-fallback where no derived rows exist.
-- Same shape the view outputs today (service_id, department_id, pct, price_share_cents, hours).
select ...
```

The view keeps its current output columns. `pct` and `price_share_cents` are calculated from `hours × department rate` divided by `sell_price_cents` — same formula as today, applied to the derived hours. Percentage-priced services keep `pct` and `price_share_cents` null.

## UI

### Service detail page — new "Includes these services" card

Sits above Process flow in the right column.

```
┌─ Includes these services ──────────────────────┐
│ ⋮ 1. Social media creative production  [3] × │
│ ⋮ 2. Content strategy document         [1] × │
│ + Add service ▾ (searchable picker)            │
└────────────────────────────────────────────────┘
```

- **Add service picker:** searchable dropdown over `services`, filtered to exclude (a) self, (b) any ancestor of this service (client-side ancestor list). Selecting a service inserts one row with `quantity = 1` and the next `ordinal`.
- **Quantity input:** integer, min 1. Autosaves on blur.
- **Remove button:** deletes the row immediately (confirmation only if the parent has no own checklist and this is the last child — the allocation will change dramatically).
- **Reorder:** up/down arrows matching the existing ProcessFlow UI.
- **Child name:** links to the child's detail page (new tab is fine but same-tab is simpler — matches existing navigation style).

### Service detail page — Process flow modes

The Process flow card's header and toolbar change depending on whether the service has children and/or its own steps.

**Simple service (no children):** unchanged from today.

**Compound, derived mode** (children exist, no own steps):
- Header: `Derived from N included services · X hrs total`
- Body: a read-only `ChecklistSummary` (the stacked bar) showing the combined breakdown. No step list — there aren't any steps on this service.
- Toolbar:
  - `Seed from children` — copies the derived hours into real `process_steps` rows (one per department with derived hours, titled e.g. "Department — work"), making them editable. After this, the service is in override mode.
  - `Add step` — adds a single empty step, entering override mode with one editable row. Equivalent to the regular "Add step" button on a simple service.
  - `Generate with AI` — unchanged; writes to this service's own `process_steps`, entering override mode.
- Rule-fallback controls (`Seed from rule`) are hidden — rules are lower-precedence when children exist.

**Compound, override mode** (children exist AND own steps exist):
- Header: `Custom checklist overrides N included services`
- Body: the standard editable step list.
- Toolbar adds one button: `Revert to derived` — deletes all own steps, falls back to the children's sum.

### `/services` grid

- **Bundle badge:** compound services get a `bundle · N` badge next to the service name (N = number of distinct child rows; quantities not shown here).
- **Rule column:** for compounds in derived mode, show `—` with a muted tooltip "Derived from included services". Compounds with own checklist or with an explicit rule fallback behave as today.
- **Dept hour cells:** for any compound with allocation coming from children (derived mode), cells are read-only, same visual treatment as "has checklist" rows. Clicking links to detail. Inline edit is disabled — you'd be editing the wrong thing.
- **Percentage-priced compounds:** allowed. Children's hours are absolute (from checklists), independent of parent price. The parent being fee-over-spend just means its own price cell works like any percentage service.

## Interaction with existing systems

- **Rules:** still exist as templates and as the lowest fallback. A compound with no own checklist and no children falls through to its rule like any simple service.
- **Overrides table:** already removed in the previous migration; not relevant here.
- **AI process generation:** untouched. Still generates a checklist for the current service. On a compound, this is the path "Override with own checklist" goes through.
- **Save-as-rule:** available on the Process flow card in override mode (same as today). Not offered in derived mode — there's no single checklist to convert.

## Migration plan

Single migration `0004_compound_services.sql`:

1. Create `service_children` table (shape above) with RLS + single `authenticated` policy.
2. Create `tg_service_children_no_cycle` trigger (before insert/update).
3. Rewrite `service_allocation_resolved` view with the three-branch recursive CTE.
4. No data backfill needed — table starts empty; every existing service is simple, unchanged behaviour.
5. Regenerate TS types via Management API.

## Rollout order

1. Migration + type regen. No UI change, nothing breaks.
2. `useServiceChildren` hook (list, add, update quantity, remove, reorder).
3. Services search hook for the "Add service" picker (simple re-query; no infinite scroll in V1).
4. `IncludedServices` component on ServiceDetail (list + add + quantity + remove + reorder + ancestor-exclusion filter).
5. ProcessFlow mode-awareness: derived header, `Override with own checklist`, `Seed from children`, `Revert to derived`.
6. ServicesList grid: bundle badge, dash rule column for derived, read-only dept cells when compound.
7. Smoke test.

## Verification gates

**SQL:**
- Insert A→B, B→C, then try C→A → cycle trigger rejects.
- Insert A→A → `check (parent_id <> child_id)` rejects.
- Service X has a checklist AND two children → `service_allocation_resolved` shows only the checklist hours.
- Service Y has no checklist and two children (one with checklist, one with rule fallback) → the view sums both paths; quantities multiply correctly.
- Delete a child service that's used in any compound → `on delete restrict` rejects.
- Delete a compound service → child rows cascade away; the child services themselves remain.

**E2E:**
- Add a child to an existing simple service → grid shows bundle badge → dept cells become read-only and reflect the child's hours.
- Add a second child with quantity 3 → dept cells update; breakdown shows the 3× multiplier.
- Override with own checklist → grid dept cells now reflect the override; badge still says bundle.
- Revert to derived → back to children's sum.
- Try to add a service as its own ancestor via the picker → picker excludes it (UX) and trigger rejects if somehow bypassed.

## Out of scope (explicit)

- "Sum of children prices vs this service's price" delta shown on the detail page. (Easy follow-up, UI only.)
- Filtering the services list by "is compound" or "used as child of X". (Easy follow-up.)
- Drag-to-reorder children (same deferral as process steps). Up/down arrows in V1.
- Fractional or percentage quantities.
- Denormalised allocation cache. Recursive view is plenty fast at our scale.
- Xero and live feedback — already V2.
