# Retainer recurring flag, monthly due date, retainer burn bar, AI tab — design

Date: 2026-06-10. Approved interactively by Brendan (AskUserQuestion, all recommended options).

## Problems

1. Standalone retainers are created with `is_recurring: false` (`create-retainer/index.ts`), so the
   project page shows "Recurring project" unchecked even though the retainer provisions monthly.
   Monthly provisioning only works because `roll-forward-recurring-tasks` has a special
   `OR engagement_type='retainer'` clause.
2. Retainers get no `due_date`, so the Due date card is empty and on-time tracking ignores them.
3. The per-department BurnChart on retainer projects shows a single "Unknown" bar: retainer
   provisioned tasks are seeded into `project_actuals` with `dept_id: null` by design
   (`_shared/retainer-actuals-logic.ts`), and their planned hours are informational only.
4. The Claude Code attribution card + Claude prompt panel clutter the Overview tab.

## Design

### 1. Retainers are recurring projects automatically

- `create-retainer` inserts the project with `is_recurring: true` (keeps
  `recurrence_mode: 'none'` — that enum drives the quote-clone paths, which retainers must not
  enter; the Phase 8 provisioner remains the execution engine).
- **Guard:** `create-recurring-tasks` (daily whole-project clone cron) adds
  `.neq("engagement_type", "retainer")` so retainers are never double-provisioned.
- Migration backfills `is_recurring = true`, `recurrence_interval = coalesce(…, 'monthly')`,
  `recurrence_start = coalesce(…, started_at::date)` for all `engagement_type='retainer'` projects.
- **Deploy order matters:** deploy the guarded `create-recurring-tasks` before applying the
  migration, otherwise the next daily run clones retainer tasks.

### 2. Monthly due date

- `create-retainer` sets `projects.due_date` to the last day of the `recurrence_start` month (UTC).
- `roll-forward-recurring-tasks` (cron, 1st of month) bulk-updates `due_date` to the current
  month-end for all non-archived retainer projects each run.
- Migration backfills current month-end where `due_date is null` for non-archived retainers.

### 3. Retainer burn bar replaces the "Unknown" chart

- On retainer projects, ProjectDetail renders a single bar — hours used this period vs
  `retainer_hours_target` — instead of the per-department BurnChart. Period hours reuse the
  tested helpers `filterBurnActuals` / `monthRange` / `currentMonthKey` from
  `usePulseRetainerBurn.ts` (current-month snapshots for in-progress, frozen snapshots for
  completed). If no target is set, show a "set the monthly target" hint instead of a bar.
- Non-retainer projects keep the department chart; the `dept_id: null` fallback label is renamed
  "Unknown" → "No department".

### 4. AI tab

- ProjectDetail gains an "AI" tab (Overview | Communications | AI). The "Claude Code attribution"
  card and the ClaudePromptPanel move into it.

## Out of scope

- Assigning departments to retainer tasks (dept-less is by design).
- Changing retainer provisioning mechanics or the pulse burn views.
