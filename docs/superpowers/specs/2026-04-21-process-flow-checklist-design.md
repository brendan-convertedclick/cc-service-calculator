# Process Flow Checklist as Allocation Source of Truth

**Status:** Design approved, pending implementation plan
**Date:** 2026-04-21
**Author:** brendan@convertedclick.co.za (with Claude)

## Context

V1 of the service calculator shipped with three layers of allocation:

1. **Rules** — named templates with per-department % that sum to 100. Every service picks one; rule % × service price ÷ dept hourly rate = hours per dept.
2. **Per-service overrides** — `service_allocation_overrides` rows replace a rule's % entirely for one service.
3. **Process steps** — an ordered checklist of work on the service detail page, with each step optionally tagged to a department with estimated hours. AI can draft the list.

The three layers are independent. Overrides override %, which drives hours. Process steps have their own hours field that nobody else reads. This means a service's "hours per department" and its "process flow" can diverge — the plan is not the budget.

This design collapses the three layers into two and makes the process-flow checklist load-bearing: **the checklist is the allocation**. Summing step hours per department gives you the service's hours breakdown directly. No more overrides; no more double-bookkeeping.

## Goals

- One source of truth per service for "how many hours go to each department."
- The process flow stops being a decorative checklist; it becomes how allocation is expressed.
- Existing ~140 seeded services keep working without requiring immediate migration to checklists — rules stay as a fallback for services that haven't been broken out into steps yet.
- Rules keep their second role as reusable templates: save a good checklist back into a named rule, seed a new service's checklist from a rule.

## Non-goals (V1 of this change)

- Step dependencies / prerequisites.
- Per-step assignees (team member on each step).
- Checklist templates as a separate concept from rules.
- Bulk "seed all services from their rule" action.
- Audit log on step edits.
- Drag-to-reorder (use up/down arrows; drag is a later polish).
- Importing steps from another service.

## Key decisions (locked)

| Decision | Choice |
|---|---|
| Source of truth for hours-per-dept | Process-step sums, when a checklist exists |
| Role of rules | Two: (a) fallback allocation for services without a checklist; (b) templates for seeding new checklists |
| Overrides | Deprecated. Existing data migrated into minimal `process_steps` rows; table kept one release cycle then dropped |
| Grid on `/services` with checklist service | Cells become read-only, link to detail page |
| Grid on `/services` without checklist | Cells editable; save creates a minimal checklist (one step per non-zero dept) |
| Percentage-priced services | Get checklists too. Hours are absolute, not price-derived. No budget line in UI |
| Step minimum | 0.25h (15 minutes), enforced client-side and via DB check constraint |
| Save as rule | Fixed-price only. Disabled for percentage services (no price to convert hours→%) |

## Data model

### `process_steps` (existing table, unchanged shape)

```
id                  uuid pk
service_id          uuid fk services
ordinal             int (unique with service_id)
title               text not null
description         text
department_id       uuid fk departments
estimated_hours     numeric(6,2) — check (estimated_hours is null or estimated_hours >= 0.25)
ai_generated        bool default false
```

New check constraint: `estimated_hours >= 0.25` (null is allowed — AI drafts may omit).

### `service_allocation_overrides` (deprecated, not dropped)

Kept with a comment marking it deprecated as of 2026-04-21. Safe to drop after one release cycle. Frontend stops writing to it immediately.

### `service_allocation_resolved` (view, rewritten)

New two-branch logic per service:

1. If `process_steps` has rows for the service → group by `department_id`, sum `estimated_hours`. Output columns: `service_id, department_id, pct, hours`. For fixed-price services, `pct = hours × dept.hourly_rate_cents / service.sell_price_cents × 100`. For percentage-priced services, `pct` is null.
2. Else if `services.rule_id is not null` → join `rule_allocations`, compute hours as today (`pct × sell_price_cents / hourly_rate_cents / 100`).
3. Else → no rows.

### `service_totals` (view, unchanged)

Already a simple rollup over the resolved view. No change needed.

### `services`

No schema changes. `rule_id` stays nullable; used for fallback and as the seed reference for checklists.

## Allocation resolution (frontend)

`useAllocationMatrix` hook signature is preserved for the most part. What changes:

- The returned `overridden: Set<string>` renames to `hasChecklist: Set<string>` — populated by querying `process_steps` for distinct `service_id`s with at least one row.
- Consumers (the grid on `/services`) treat `hasChecklist` as the signal to make cells read-only.

`useSetServiceAllocationOverrides` renames to `useSetServiceChecklist`. Its mutation:
- Input: `{ serviceId, hoursByDept: Record<deptId, number> }` (when called from the grid shortcut) OR the full `steps[]` array (when called from the detail page editor).
- Behavior (grid shortcut path): deletes existing `process_steps` for the service, inserts one row per dept with non-zero hours. Each row gets `title = '{Dept} work'`, `ordinal` in dept display order, `ai_generated = false`.
- Behavior (detail page path): deletes existing rows, inserts the provided steps in order.
- Behavior (revert path): deletes all rows for the service, falls back to rule.

## UI: service detail (`/services/:id`)

### Layout

Existing top-of-page form (name, price, rule dropdown, scope fields, etc.) is unchanged. Below it, the Process Flow section is the new main attraction.

### Header of the section

- **Precedence badge** — one of:
  - `Using rule: {Rule name}` (when no steps exist) — with a `Seed checklist from rule` button beside it.
  - `Custom checklist · N steps` (when steps exist).
- **Toolbar** (right-aligned):
  - `Generate with AI` — existing flow, unchanged: calls `generate-process-steps` edge function, presents review modal, inserts on confirm.
  - `Save as rule` — fixed-price only. Opens a modal with name (required), description (optional), and a preview of the dept % split derived from current step hours. If the name collides with an existing rule, the modal offers **Overwrite** (replace allocations) or **Save as new name**.
  - `Clear checklist` — confirms, then deletes all steps for the service. Falls back to the rule.

### Step list

Ordered list. Each row:
- Up/down arrow buttons (reorder — drag is post-V1)
- Ordinal number (display-only, computed from position)
- Step title (inline text input, required)
- Department dropdown (required, list of active depts)
- Hours input (number, step 0.25, min 0.25)
- Description (collapsible; click to expand/edit, optional)
- Delete (x)

Below the list: **+ Add step** button. New steps default to `title = ''`, department = first active dept, hours = 0.25.

### Summary bar

Two rows below the step list:

1. **By department** — horizontal stacked bar showing dept totals and a text summary (`SEO 1.0h · Dev 2.0h · PM 0.5h · Total 3.5h`). This is what the grid on `/services` reads.
2. **Price coverage** (fixed-price only) — text: `Budget: R3,300. Planned: R3,625 (110%)`. Amber at >100%, red at >110%, green at ≤100%. Hidden for percentage-priced services.

### Seed from rule

When a service has a `rule_id` but no `process_steps`, the section shows the `Seed checklist from rule` action. Clicking it:
- Generates one placeholder step per department that has non-zero `pct` in the rule.
- Title: `'{Dept} — work'`.
- Hours: `round(pct × price / dept_rate / 100 / 0.25) × 0.25`, clamped to a minimum of 0.25.
- Ordinal: sequential in dept display order.
- After seeding, the user edits freely.

## UI: services grid (`/services`)

### Read path

`useAllocationMatrix` reads from the new view. No change to the hook's consumers beyond the rename of `overridden` → `hasChecklist`.

### Write path

- **Service in `hasChecklist`:** all dept cells for that row are read-only. Cursor is `not-allowed`; tooltip reads `Edit in service detail`. Cell is a link to `/services/:id`. The row-level save/cancel/revert buttons don't appear for these rows.
- **Service not in `hasChecklist`:** cells are editable as today. On save, the mutation creates `process_steps` rows (grid shortcut path above). Toast: `Saved as checklist for {Service}. Edit steps on detail page.` After save, the service moves into `hasChecklist` and the cells become read-only on the next render.

### Badges and labels

- The existing `override` badge next to the service name renames to `checklist`.
- Services still using rule fallback get no badge (same as today's "no override" state).
- The **Rule** column shows the rule name. For a service with a checklist, the rule name is greyed out with a `(fallback)` suffix — it's not driving allocation anymore, it's just a memory of the seed/template.

### Revert button

- For services with a checklist: existing revert button stays, now deletes all `process_steps` for the service atomically. Confirmation copy: `Delete the checklist for {Service} and fall back to its rule's allocation?`
- For services without a checklist: revert button does not render.

### Percentage-priced services in the grid

Today the grid renders `—` for every dept cell and the Total cell when `pricing_model = 'percentage'`. After this change that carve-out goes away entirely: percentage services behave like every other service in the grid. Dept cells show step-sum hours when a checklist exists (editable when not), and the Total column shows the sum of step hours. The detail page still hides the Price Coverage bar and disables the **Save as rule** button for these services — those disables live on the detail page, not the grid.

### Total column

- Fixed-price and hourly services: sum of `estimated_hours` across checklist (or rule-derived hours when falling back).
- Percentage-priced services: sum of checklist hours when a checklist exists, else `—`.

### Grid limitation (deliberate)

No way to edit a step's title, description, or ordering from the grid. Those require the detail page. The grid is strictly for hours-per-dept.

## Migration (`0003_checklist_source_of_truth.sql`)

1. **Backfill `process_steps` from `service_allocation_overrides`:**

   ```sql
   insert into process_steps (service_id, ordinal, title, department_id, estimated_hours, ai_generated)
   select
     o.service_id,
     row_number() over (partition by o.service_id order by d.display_order),
     d.name || ' work',
     o.department_id,
     greatest(0.25, round((o.pct * s.sell_price_cents / d.hourly_rate_cents / 100) / 0.25) * 0.25),
     false
   from service_allocation_overrides o
   join services s on s.id = o.service_id
   join departments d on d.id = o.department_id
   where s.sell_price_cents > 0;
   ```

   (Percentage-priced services have `sell_price_cents = 0` and no overrides anyway — excluded by the join.)

2. **Rewrite `service_allocation_resolved`** with the two-branch logic above.

3. **Add check constraint:** `alter table process_steps add constraint process_steps_min_hours check (estimated_hours is null or estimated_hours >= 0.25)`.

4. **Leave `service_allocation_overrides` in place** with a comment: `comment on table service_allocation_overrides is 'Deprecated 2026-04-21 — migrated into process_steps. Safe to drop after one release cycle.'`. Do not drop.

5. **Drop the sum-to-100 trigger on `service_allocation_overrides`** (if present). It's a dead constraint on a deprecated table and would prevent future cleanup writes. The equivalent trigger on `rule_allocations` stays — rules still must sum to 100%.

6. **No sum constraint on `process_steps`.** Step hours represent plan not budget. Over-budget is shown in the UI (amber/red on the Price Coverage bar) but not blocked at save time.

## Frontend rollout

All in one PR with the migration. No feature flag — internal tool, shared login, low blast radius.

**Files changed:**

- [src/hooks/useServices.ts](src/hooks/useServices.ts) — rename `useSetServiceAllocationOverrides` → `useSetServiceChecklist`; rename `overridden` → `hasChecklist`; mutation writes `process_steps` rows.
- [src/pages/ServicesList.tsx](src/pages/ServicesList.tsx) — add read-only branch for rows in `hasChecklist`; rename `override` badge to `checklist`; grey out rule name with `(fallback)` suffix when a checklist is active.
- [src/pages/ServiceDetail.tsx](src/pages/ServiceDetail.tsx) — fold existing `ProcessFlow.tsx` into the detail page as the new checklist editor. Add toolbar (Generate with AI, Save as rule, Clear checklist), summary bar (by dept + price coverage), seed-from-rule action, step list with up/down reordering.
- [src/components/ProcessFlow.tsx](src/components/ProcessFlow.tsx) — either absorbed into ServiceDetail or kept as a narrower presentational component for the step list. Decide during implementation based on file size.
- New modal component for **Save as rule** (name, description, collision handling).
- New migration: `supabase/migrations/0003_checklist_source_of_truth.sql`.

**Rules page:** untouched by this change. `Save as rule` hits the existing `rules` + `rule_allocations` tables directly.

## Verification

**Data migration:**
- Row count: every service with `service_allocation_overrides` rows before migration has matching `process_steps` rows after (grouped by service_id and counted).
- Hours parity: resolved hours for migrated services are within ±0.25h of pre-migration resolved hours (quarter-rounding is the only loss).
- Spot-check three migrated services by hand against the pre-migration `service_allocation_resolved` output.

**Smoke tests on deployed build:**
- Service with rule + no checklist: grid shows rule-derived hours; detail page shows `Using rule: X` badge and `Seed from rule` button.
- Service that had overrides: grid shows same hours as before (quarter-rounded); detail page shows a checklist with one step per migrated dept; `checklist` badge shown.
- Percentage-priced service: detail page shows checklist editor with no budget line; grid Total column shows 0h until a checklist exists, then shows the sum.
- AI generate: still works end-to-end on a fresh service; inserted steps display correctly; precedence badge flips to `Custom checklist`.
- Edit grid cell for checklist-less service: save succeeds; cells become read-only on refresh; `checklist` badge appears.
- Edit grid cell for service with checklist: input is disabled; tooltip shows.
- Revert: deletes steps; cells return to editable; grid shows rule-derived hours.
- Save as rule: creates a new rule with dept % derived from current checklist; rule name collision modal works.
- Clear checklist from detail page: deletes steps; service falls back to rule.

**Negative tests:**
- Hours < 0.25: client blocks input; if somehow submitted, DB check constraint rejects.
- Save as rule on a percentage service: button is disabled.

## Open follow-ups (not blockers)

- Drag-to-reorder in the step list (after V1 of this change).
- Bulk "seed all services from their rule" one-click migration for the 139 seeded services currently on rule fallback.
- Consider adding an optional "re-link to this new rule and clear my bespoke checklist" action inside the `Save as rule` modal (mentioned during brainstorm). Not critical — a user can do the same thing manually in two clicks.
- Eventually drop `service_allocation_overrides` after one release cycle of no writes.
