# School year results — design

**Date:** 2026-09-28 · **Status:** approved by Brendan via mockup iterations 1–7 (reviews the build at the end)
**Reference mockup:** `2026-09-28-school-year-results-mockup.html` (open it in a browser; it is the approved UX, not code to port)

## Why

A school's marketing gets better only if every month's work and its results are recorded the same way each year. Today nothing records results. This adds a 12-month planner per client where the team plans what will go out, attaches results after the month, and compares any number of earlier years side by side.

## What the user sees

- **Planner** at `/results/:clientId`. Rows grouped down the left (e.g. *Paid media* → Google Search, PMax, Meta ads; *Social media*; *Content* → Ultimate guides; *Events* → Open Day · Term 1; *Campaigns*). Twelve month columns, Jan–Dec, calendar year.
- **Year picker** (single select, defaults to the current year, no "now" label) and a **"Compare with…" multi-select** of other years. Each compared year is a horizontal band under every row, filled with a grey that depends only on how many years back it is (1, 2, 3+), so a given year is the same grey in every row. The current year has no band. Compared-year cells are dotted and show the same starred metrics as the current year's card (changed 2026-09-30: showing only the first star hid half of the comparison), and a year label appears once per band in a narrow column, never per cell.
- **Group filter**: multi-select of groups with "Show all". Ticking only Social media shows only that group.
- **Cell states**: empty (hover "+ Plan") · planned (dashed, group colour, first plan value) · results due (month is over, no results; amber dashed) · results in (filled with group colour, shows up to two starred metrics as "84 families").
- **Side panel** on click: plan metrics, result metrics (disabled until the month starts, rule 7), and a "How it compares" list for numeric results: value, "of N target" when paired, and last year's value with % change. Explicit **Save** button (no autosave).
- **Add group** (name, colour from a fixed six, template) and **+ Add a row to <group>** (name, optional template override) inline in the grid. Group colour colours all its rows.
- **"Start from the standard groups"** button when a client has no groups: creates Paid media / Social media / Content / Events / Campaigns with the mockup's rows.
- **Templates** at `/results/templates`: master template library for the whole agency. List on the left, editor on the right, rules card. Edit metric name, grid label, type, target pairing, star, retire/restore, add metric, rename template, new template. Grid-cell preview.

## Rules (load-bearing)

1. **One master, every client.** Templates are global rows; groups and rows point at them. No per-client copies.
2. **Metrics have a fixed identity** (uuid). Renaming never detaches past values.
3. **Retired, never deleted.** `retired_at` hides a metric from new entry; its values stay and still show read-only where they exist. FK from values to fields is `on delete restrict`.
4. **Type locks once data exists.** A trigger refuses a `type` change on a field that has any value row.
5. **Stars**: only result-phase fields; at most two per template (the editor unstars the oldest when a third is starred; a trigger also refuses a third). Compared years show every starred field, in ordinal order.
6. **Targets**: a numeric result field may point at a numeric plan field in the same template (`target_field_id`).
7. **Results open when the month starts** (current month and past months). Plans can be written for any month, any year.
8. **Rows are not per-year.** A row persists across years; that is what makes years comparable. Entries are keyed `(row_id, year, month)`.

## Data model (migration `0178_school_results.sql`)

```
results_templates        id, name, created_at, updated_at
results_template_fields  id, template_id → templates (cascade), label, short_label,
                         type check in (number, money, percent, date, text),
                         phase check in (plan, result), star bool default false,
                         target_field_id → fields (set null), ordinal int, retired_at,
                         check (not star or phase = 'result')
results_groups           id, client_id → clients (cascade), name, colour check in six,
                         template_id → templates (restrict), ordinal
results_rows             id, group_id → groups (cascade), name,
                         template_id → templates null (override), ordinal
results_entries          id, row_id → rows (cascade), year int, month int 1–12,
                         created_by / updated_by → team_members null, timestamps,
                         unique (row_id, year, month)
results_entry_values     entry_id → entries (cascade), field_id → fields (restrict),
                         num_value numeric, text_value text, date_value date,
                         primary key (entry_id, field_id)
```

- **Money is int cents in `num_value`** (project convention); formatted with `formatZar`. Percent stores the number (3.8 = 3.8%).
- Triggers: type-lock on `results_template_fields`; max-two-stars on insert/update of `star`; `updated_at` touch.
- **RLS**: all tables `select` for `authenticated`. Templates and fields: write only `current_team_member_role() in ('admin','owner')` (it resolves the shared team@ login to owner). Groups, rows, entries, values: write for any `authenticated` (staff record results, same stance as the systems library, 0118).
- **Seed** the six templates from the mockup (Paid channel, Social, Guide, Open day, Event, Campaign) with their fields, stars and targets. No seeded groups; the "standard groups" button creates them per client.

## Code layout

- `src/lib/results-grid.ts` (pure, unit-tested): `cellState`, `formatValue`, `starredFields`, `planHeadline`, `compareLine` (target + year delta), `laneShade(year, compareYear)`, `STANDARD_GROUPS`.
- `src/hooks/useResults.ts`: `useResultTemplates`, `useResultsBoard(clientId, years[])`, `useSaveEntry`, `useAddGroup`, `useAddRow`, `useSeedStandardGroups`, template mutations (`useUpdateTemplate`, `useUpdateField`, `useAddField`, `useAddTemplate`). Singleton supabase client, `errorMessage(e)`, TanStack Query.
- `src/pages/ResultsPlanner.tsx`, `src/pages/ResultsTemplates.tsx`, `src/pages/ResultsIndex.tsx` (list of clients with a school year or with results groups, links to each planner) + components under `src/components/results/`.
- Routes inside the admin gate: `/results`, `/results/templates`, `/results/:clientId`. Nav item "Year results" next to Pipeline.
- M3 token classes only (`bg-m-…`, `text-m-…`), no hex in components. Group colours map to existing token roles or a small constant map of Tailwind classes; the six-colour palette must work in light and dark.

## Out of scope (V1)

- Client portal visibility or client-entered results (agreed later phase; `results_entries` has no client author yet).
- Calculated metrics (cost per lead), per-client extra metrics, drag reordering, deleting groups/rows (archive later), importing past data.

## Testing

- Vitest for `results-grid.ts` (states at month boundaries, formatting, star order, compare deltas incl. zero/blank last year).
- Hook/page smoke via existing test setup where cheap; manual browser check on the dev server.
- Gates: `npm run verify`, `npm run lint:dead`, `npm run build`.
