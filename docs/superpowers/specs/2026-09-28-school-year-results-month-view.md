# School year results — Month view (addendum)

**Date:** 2026-09-28 · **Approved by Brendan** via mockup iterations 8–10 (`2026-09-28-school-year-results-mockup.html`, Month view is the default view in that file).
Builds on `2026-09-28-school-year-results-design.md`; everything there still holds.

## What

The planner at `/results/:clientId` gets a **Year | Month** switch. Month view is a Monday-first calendar of one month so specific event dates are visible, and you can plan from a day.

- Toolbar in Month view: ‹ month-name year ›, group filter stays; year picker and "Compare with" are hidden.
- Each item (row entry for that year+month) is a **chip** on its day, group-coloured, same three states as the grid: planned (dashed), results due (amber dashed), done (filled). Chip shows the row name and either the starred metrics ("84 families · 23 applications") or the plan headline.
- Items with no day sit in an **"Anytime this month"** strip above the calendar.
- Each day shows the **same dashed "+ Plan" box** as an empty year-grid cell, on hover or keyboard focus (always visible on touch). Clicking opens an inline form: a select of rows grouped by group (rows that already have an item this month are marked "(move here)"), and **Plan it**. That sets the item's day (creating a planned entry if none), fills the row template's first live plan-phase Date metric with that date if it has one, then opens the same side panel.
- Clicking a chip opens the same side panel as the grid. The panel gains **"Day in <Month> (optional)"** (number 1–last day); blank = anytime.
- Today's date is marked.

## Rules

1. **One item per row per month** (unchanged `unique (row_id, year, month)`). Planning a row on another day moves its existing item.
2. **Where the day comes from:** `results_entries.day` if set, else the first live date-type field value that falls in that year+month, else anytime.
3. An entry with only a day and no values is a real planned item (it must not be deleted by the empty-entry cleanup in `useSaveEntry`).
4. Calendar dates are string-keyed `YYYY-MM-DD` in local time. Never `toISOString()` (CLAUDE.md: SAST dates shift). Reuse `src/lib/calendar-month.ts` (`monthGrid`, `WEEKDAY_LABELS`) for the grid.

## Data

Migration `0179_results_entry_day.sql`: `alter table results_entries add column if not exists day smallint check (day between 1 and 31)`. The UI clamps to the month's length.
