# Profitability Tab — Design Spec

**Date:** 2026-05-13
**Status:** Approved

## Overview

Add a fourth tab ("Profitability") to the Productivity page in the CC Service Calculator. The tab shows project-level gross margin for all active (`in_progress`) projects, giving a real-time view of how profitable the current pipeline is.

## Decisions Made

| Question | Decision |
|---|---|
| Revenue proxy | `quotes.total_cents` (quoted value) |
| Cost source | `project_actuals_current.actual_hours × departments.cost_rate_cents` |
| Project scope | Active (`in_progress`) projects only |
| RAG threshold | Per-client `clients.margin_target_pct` (default 40%) |
| Layout | 4 KPI cards + sortable project table |
| Person filter | `selectedUserId` from TeamSidebar is ignored on this tab |

## Data Model

### Margin formula

```
cost_cents   = SUM(actual_hours × dept.cost_rate_cents) per project
               (falls back to dept.hourly_rate_cents if cost_rate_cents is null)
margin_cents = total_cents - cost_cents
margin_pct   = margin_cents / total_cents × 100

rag = "green"  if margin_pct ≥ client.margin_target_pct
    = "amber"  if margin_pct ≥ client.margin_target_pct - 5
    = "red"    otherwise
    = "red"    if total_cents = 0
```

### Return type

```typescript
export type ProjectProfitabilityRow = {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  quotedCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
  targetPct: number;
  rag: "green" | "amber" | "red";
};
```

### Query sequence

1. `projects` — `id`, `quote_id`, `client_id`, `name` where `status = 'in_progress'`
2. `quotes` — `id`, `total_cents` for project `quote_id`s
3. `project_actuals_current` — `project_id`, `actual_hours`, `dept_id` for those project ids
4. `departments` — `id`, `cost_rate_cents`, `hourly_rate_cents`
5. `clients` — `id`, `name`, `margin_target_pct`

All joins done in TypeScript. No new migration required.

## Component Architecture

### New files

```
src/hooks/useProjectProfitability.ts
src/components/productivity/ProfitabilityTab.tsx
src/components/productivity/ProfitabilityTable.tsx
```

### Modified files

```
src/pages/ProductivityPage.tsx   — add "profitability" to tab union + render ProfitabilityTab
```

### Component responsibilities

**`useProjectProfitability`**
- Fetches and joins all data
- Computes margin and RAG per project
- Returns `ProjectProfitabilityRow[]` sorted by `margin_pct` descending
- `staleTime: 5 * 60 * 1000` (matches existing hooks)

**`ProfitabilityTab`**
- Calls `useProjectProfitability`
- Renders 4 KPI summary cards
- Renders `<ProfitabilityTable rows={rows} />`
- Handles loading and empty states

**`ProfitabilityTable`**
- Receives `rows: ProjectProfitabilityRow[]` as props
- Client-side sort state: column + direction, default `margin_pct desc`
- Clicking Margin column header toggles asc/desc
- Columns: Project · Client · Quoted · Cost · Margin · Status

**`ProductivityPage`**
- Extends tab union: `"sprint" | "multiplier" | "delivery" | "profitability"`
- Adds "Profitability" button to tab bar
- Renders `<ProfitabilityTab />` when `pageTab === "profitability"`
- Does not pass `selectedUserId` to `ProfitabilityTab`

## KPI Cards

| Card | Value | Label |
|---|---|---|
| Portfolio Margin | `SUM(marginCents) / SUM(quotedCents) × 100` — revenue-weighted avg | "across N active projects" |
| Total Quoted | Sum of `quotedCents` formatted as ZAR | "in active pipeline" |
| Best Margin | Project name + margin_pct | Highest margin project |
| Needs Attention | Project name + margin_pct | Lowest margin project (or first Red RAG) |

## Table Columns

| Column | Source | Format | Sortable |
|---|---|---|---|
| Project | `projectName` | Text | No |
| Client | `clientName` | Text | No |
| Quoted | `quotedCents` | ZAR formatted | No |
| Cost | `costCents` | ZAR formatted | No |
| Margin | `marginPct` | Percentage (1 dp) | Yes — default sort desc |
| Status | `rag` | Green / Amber / Red pill | No |

## Edge Cases

| Case | Behaviour |
|---|---|
| No active projects | Empty state: "No active projects found. Projects appear here once a quote is accepted and moved to in progress." |
| Project with no actuals | `costCents = 0`, `marginPct = 100%`, RAG = green |
| Dept with no cost rate | Falls back to `hourly_rate_cents`; if both null, cost contribution = 0 |
| `total_cents = 0` on quote | `marginPct = null`, RAG = red |
| Loading | Spinner centred in tab body |

## Styling Notes

- Follows existing tab patterns in `ProductivityPage` exactly
- RAG pill colours: green `#14532d / #4ade80`, amber `#713f12 / #facc15`, red `#7f1d1d / #f87171`
- KPI cards use `bg-m-surface` with coloured border for best/worst cards
- Table uses same header/row pattern as other tables in the app
