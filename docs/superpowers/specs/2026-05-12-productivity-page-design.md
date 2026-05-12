# Productivity Page — Design Spec

**Date:** 2026-05-12  
**Status:** Approved

---

## Overview

A new `/productivity` page in the cc-service-calculator app that shows team sprint point output and time tracked, pulled live from ClickUp. Designed for daily team review — default view is the whole team, filterable to individual members.

---

## 1. Routing & Navigation

- Add `/productivity` route to `src/App.tsx` under the existing `AppShell` group (lazy-loaded).
- Add a nav item to `src/components/nav/navItems.ts`:
  - Label: `Productivity`
  - Icon: `TrendingUp` (lucide-react)
  - Path: `/productivity`
  - Gradient: `linear-gradient(135deg, #059669, #0891B2)` (green → cyan)
- New page component: `src/pages/ProductivityPage.tsx`

---

## 2. Layout

Two-column layout (no `AppShell` sidebar — the page provides its own left panel):

### Left sidebar (fixed, ~176px wide)

- Section heading: "Team"
- First row: "Whole team" (star icon avatar, shows total points for the period)
- Subsequent rows: one per non-archived team member from `useTeam()`, ordered by `full_name`
- Each row shows: coloured avatar (initials), name, sprint point total for the current period
- Active selection highlighted with `bg-m-primary-container` / `text-m-on-primary-container` — matches existing nav pattern in `navItems.ts`
- Single selection only; clicking a member filters both charts

### Main area

- Page header row: title "Productivity" + view tab group (Year / Month / Week)
- Summary metric cards (4 across):
  - Total sprint points for period
  - Daily average vs goal (coloured green if ≥ goal, amber if within 10%, red if below)
  - Total hours tracked
  - Active contributors count
- Sprint points chart (see Section 4)
- Hours tracked chart (see Section 4)

---

## 3. Data Layer

### Edge function: `get-productivity`

**Location:** `supabase/functions/get-productivity/index.ts`

**Request body:**
```ts
{
  view: 'year' | 'month' | 'week'
  date: string          // ISO date — anchor for the period (e.g. "2026-05-12")
  clickup_user_id?: number  // omit for whole-team
}
```

**Response:**
```ts
{
  sprintPoints: { bucket: string; userId: number; points: number }[]
  timeEntries:  { bucket: string; userId: number; hours: number }[]
  meta: {
    periodLabel: string   // e.g. "May 2026", "W20 2026", "2026"
    totalPoints: number
    totalHours: number
    dailyAvg: number      // points / working days in period
    activeContributors: number
  }
}
```

**Internal ClickUp calls (parallel):**

1. **Tasks** — `GET /space/{clickup_clients_space_id}/task`
   - Params: `include_closed=true`, `subtasks=true`, `date_done_gt={start_ms}`, `date_done_lt={end_ms}`
   - If `clickup_user_id` provided: `assignees[]={clickup_user_id}`
   - Extract: `task.points` (native ClickUp field), `task.assignees[].id`
   - Group by assignee + bucket

2. **Time entries** — `GET /team/{clickup_workspace_id}/time_entries`
   - Params: `start_date={start_ms}`, `end_date={end_ms}`
   - If `clickup_user_id` provided: `assignee={clickup_user_id}`
   - Extract: `entry.duration` (ms), `entry.user.id`
   - Convert ms → hours, group by user + bucket

**Bucket logic by view:**
- `year`: bucket = `YYYY-MM` (12 buckets)
- `month`: bucket = `YYYY-MM-DD`, working days only (Mon–Fri)
- `week`: bucket = day-of-week label (`Mon`–`Fri`) for the ISO week containing `date`

**Auth:** Uses `CLICKUP_PAT` secret. Reads `settings` row (id=1) for `clickup_workspace_id`, `clickup_clients_space_id`, `clickup_enabled`. Returns 400 if ClickUp is disabled or PAT not set. Deployed with `verify_jwt=false` (consistent with other edge functions in this project).

### Frontend hook: `useProductivity`

**Location:** `src/hooks/useProductivity.ts`

```ts
useProductivity(view: View, date: string, clickupUserId?: number)
```

- Uses TanStack Query; `staleTime: 5 * 60_000`
- Calls `supabase.functions.invoke('get-productivity', { body: { view, date, clickup_user_id } })`
- Query key: `['productivity', view, date, clickupUserId ?? 'team']`

---

## 4. Charts

Both charts use **Recharts** (already in the project via existing `BurnChart.tsx`).

### Sprint Points chart

- `BarChart` with stacked bars
- One `Bar` series per team member, each with a distinct colour drawn from a fixed palette (matches sidebar avatar colours):
  - Member colours assigned by index: `['#7C3AED', '#EC4899', '#0891B2', '#059669', '#D97706', '#E11D48', '#4F46E5']`
- `ReferenceLine` at the `productivity_goal_points` setting value — dashed amber (`#f59e0b`), labelled `GOAL {n} pts`
- When a single member is selected: single-colour bars (that member's colour), no stacking needed
- Tooltip shows breakdown by member + total for that bucket

### Hours Tracked chart

- `BarChart`, single series, blue (`#3b82f6`)
- No goal line
- Tooltip shows hours to 1 decimal place

### Date navigator

Both charts sit inside a shared container with:
- `◀` / `▶` buttons to page prev/next period
- Current period label in the centre (e.g. "May 2026")
- Defaults to current period on load

---

## 5. Settings Integration

### DB migration

Add column to `settings` table:
```sql
alter table settings
  add column if not exists productivity_goal_points integer not null default 40;
```

### Settings page

Add "Productivity" to the `NAV` array in `src/pages/Settings.tsx`:
- Section key: `productivity`
- Shows a numeric input for "Daily sprint point goal (team total)"
- Saves via `useUpdateSettings()` mutation
- Input validates: integer, min 1, max 999

### Type update

Regenerate `src/types/db.ts` after migration (`mcp__cc-supabase__generate_typescript_types`).

---

## 6. Component breakdown

| File | Purpose |
|---|---|
| `src/pages/ProductivityPage.tsx` | Page shell — layout, state for view/date/selectedUser |
| `src/components/productivity/TeamSidebar.tsx` | Left panel — member list, selection state |
| `src/components/productivity/ProductivityControls.tsx` | View tabs + date navigator |
| `src/components/productivity/MetricCards.tsx` | 4-up summary row |
| `src/components/productivity/SprintPointsChart.tsx` | Stacked bar chart + goal line |
| `src/components/productivity/HoursTrackedChart.tsx` | Hours bar chart |
| `src/hooks/useProductivity.ts` | TanStack Query hook |
| `supabase/functions/get-productivity/index.ts` | Edge function |

---

## 7. Out of scope for this iteration

- Persisting productivity data to Supabase (live ClickUp queries only)
- Per-person daily goals (team goal only)
- Exporting charts
- Comparing periods side by side
