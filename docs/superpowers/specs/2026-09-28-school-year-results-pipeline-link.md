# School year results — pipeline tasks as plans (addendum)

**Date:** 2026-09-28 · **Approved by Brendan** in chat (option B, "straight to building").
Builds on `2026-09-28-school-year-results-design.md` and `…-month-view.md`.

## What

A school's pipeline (`/pipeline/:yearId`, `school_tasks`) is where future work is planned. Some of those tasks are events that belong on the Year results planner. Ticking **"Show in Year results"** on a pipeline task links it to one results row; from then on the task **is** that row's plan for the task's month.

## Single source of truth

- New table `results_task_links (school_task_id uuid primary key → school_tasks on delete cascade, row_id uuid not null → results_rows on delete cascade, created_by → team_members null, created_at)`. One row per task: a task links to at most one results row. Nothing about the task is copied.
- Year results reads label, month, date, side and done state **live** from `school_tasks` on every load. Moving, renaming or completing the task in the pipeline changes Year results with no sync step.
- RLS: select/write for any `authenticated` (same stance as results rows/entries). The link row's results row must belong to the same client as the task's school year: enforce with a trigger (`school_tasks → school_years.client_id` = `results_rows → results_groups.client_id`), raise otherwise.

## Where a linked task lands

- **Calendar month and year:** `due_date` if set; otherwise the date its pipeline month hands out via the existing `school_task_due_on(...)` function with `p_clamp_forward => false` (0159: the calendar uses false). Expose this through a read-only view `results_linked_tasks` (task id, row_id, label, side, state, done_at, effective_date `date`, year, month, day, year_id, client_id) so the client never re-derives the date rule. Check the function's actual signature in `supabase/migrations/0159_school_plan_on_the_client_calendar.sql` and later migrations before writing the view.
- In the **year grid**, the row's cell for that month shows the task (label, an **Ours** / **School** tag from `side`, done tick when `state = 'done'`). A linked task alone makes the cell at least "planned"; results due / done still follow the results metrics (rule: `cellState` treats a linked task like a plan).
- In the **Month view**, the chip sits on the task's day (link wins over `results_entries.day` and the template date metric for that row+month; if both a link and a different entry day exist, the task's date wins and the entry day is ignored for display).
- Several tasks can link to the same row in the same month (e.g. two open day sessions): show them all in the cell/chip list; results remain one entry per row per month.
- The **entry panel** shows linked tasks for that row+month read-only at the top of Plan (label, side tag, date, done), each with a link to `/pipeline/:yearId`. Results are recorded as normal.

## In the pipeline

- Each task card (`src/components/pipeline/TaskCard.tsx`, and wherever tasks are listed in `SchoolDrawer`) gets a **"Show in Year results"** control. Off → click opens a small picker of that client's results rows grouped by group (if the client has no results groups, say so and link to `/results/:clientId`). On → shows the linked row name and an unlink action. Unlinking deletes only the link row.

## Out of scope

- Linking from the Year results side; linking non-school clients (they have no pipeline); copying pipeline tasks into results entries.
