# Retainer Budget Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone asking for more time on a retainer sees Budget, Spent, To do and Free for it first, the same bar appears wherever that ask is judged, everyone can see their clients' bars, and finally the approval tier is decided by what the retainer has Free.

**Architecture:** One SECURITY DEFINER SQL function, `retainer_budget(p_month, p_client_id)`, is the only calculation: per retainer × department it returns alloc, spent and to-do hours plus the retainer's budget. A pure TS module summarises its rows and owns the verdict rule. One React component draws the bar. Four surfaces render that component; the last task moves the tier decision into a DB trigger that calls the same function.

**Tech Stack:** Postgres (Supabase), Vite + React 18 + TypeScript, TanStack Query, Tailwind M3 tokens, Vitest + Testing Library.

**Spec:** the design artifact https://claude.ai/artifact/NJmQ4e4vraLUBE1XSmYJMR (section "Budget, Spent, To do, Free") and the memory note `project_budget_visibility.md`. The artifact's JS (`consume`, `rBook`) is a working reference for the drawing rules; its numbers are not fixtures.

## Global Constraints

- Vocabulary, everywhere in UI copy: **Budget** (what the fee buys) · **Spent** (hours tracked in the month) · **To do** (open booked work: estimate minus time already logged, floor 0) · **Free** = Budget − Spent − To do. Never use "Planned" for booked work.
- Budget hours = `retainer_monthly_fee_cents / 115000.0` (R1,150/h); when the fee is null, `retainer_hours_target`. A retainer with neither has no budget and is not shown.
- 1 point = 0.25h (`HOURS_PER_POINT`, `pointsToHours`).
- Months are SAST "YYYY-MM": `to_char(ts at time zone 'Africa/Johannesburg','YYYY-MM')` in SQL, `todayISO().slice(0,7)` in TS. Never `toISOString()`.
- No " — " in UI copy (split into two sentences). Numbers render with `tabular-nums`.
- Colours via tokens only (`m-` classes / CSS vars). No hex in components.
- Shared helpers: `errorMessage(e)`, `callEdgeFn`, `todayISO`, the `supabase` singleton (see CLAUDE.md table).
- Migrations are numbered from `0203`, applied through the Management API query endpoint (cc-supabase MCP is unauthorised this session) with a manual ledger row: `insert into supabase_migrations.schema_migrations (version, name) values ('<YYYYMMDDHHMMSS>','<bare_name>')`.
- Gates before any "done": `npm run verify`, `npm run lint:dead`, `npm run build`. Work in a worktree branch (`superpowers:using-git-worktrees`), copy `.env.local` in, dev server on a free port, never `pkill -f vite`.

## Review Focus

1. **A client with several retainers** (Trellidor has more than one). The form must show the retainer the picked task books to, not a sum of all of them. Test in Task 4.
2. **A task no brief knows about** (ClickUp-native, or a recurring task). Fall back to every budgeted retainer of the client, each its own bar, with a line saying which task could not be placed. Test in Task 4.
3. **The first hours of a month.** Between 00:00 and 02:00 SAST, UTC is still last month. `currentBudgetMonth()` must use SAST. Test in Task 2.
4. **Open work with no estimate.** It contributes 0 to To do, which understates it. The function returns `unestimated_count` and the bar says "N open tasks have no estimate". Test in Task 3.
5. **The shared `team@` login** (`currentUserId` null) on My work. The Budgets card shows every client's bar rather than none, and the request form keeps working. Test in Task 6.

---

### Task 1: `retainer_budget` SQL function

**Files:**
- Create: `supabase/migrations/0203_retainer_budget.sql`

**Interfaces:**
- Produces: `retainer_budget(p_month text, p_client_id uuid default null) returns table (project_id uuid, project_name text, client_id uuid, client_name text, department_id uuid, department_name text, budget_hours numeric, alloc_hours numeric, spent_hours numeric, todo_hours numeric, unestimated_count int)`. One row per (retainer, department), department null = nobody's department. `budget_hours` is repeated on every row of a retainer. Every budgeted retainer returns at least one row, even with nothing tracked.

- [ ] **Step 1: Write the function.** `language sql stable security definer set search_path = public`; `grant execute ... to authenticated`. It returns hours only, never fee cents, which is why staff may call it while `projects` stays admin-readable.
  - Retainers: `projects` with `engagement_type = 'retainer'`, `status = 'in_progress'`, budget per Global Constraints > 0, `p_client_id` null or matching.
  - A retainer's tasks, mirroring `useRetainerAllocation`: briefs with `parent_project_id = p.id` and `status in ('briefed','accepted','quoted','scoped')`; `retainer_recurring_delivery` rows with `project_id = p.id`; `ongoing_tasks` with `project_id = p.id and archived_at is null`.
  - **spent**: `clickup_time_entries` on those tasks, `duration_ms > 0`, SAST month = `p_month`, grouped by the logger's `team_members.primary_department_id` (join on `clickup_user_id::text`).
  - **to do**: briefs whose `clickup_task_status is distinct from 'closed'` and `completed_at is null`: `greatest(0, coalesce(clickup_points, original_points) * 0.25 − all-time tracked on the task)`, department from `assignee_id`'s primary department. Plus `retainer_recurring_delivery` rows for `p_month` with `is_closed = false`: `greatest(0, planned_hours − all-time tracked)`, department from the `provisioned_tasks.assignee_id` whose `clickup_task_ids` contains the task. Ongoing tasks contribute no to-do. `unestimated_count` counts open briefs with both point columns null.
  - **alloc**: `retainer_recurring_services` with `paused_at is null`: `points_per_occurrence * occurrences_per_month * 0.25 * rule_allocations.pct / 100` through `services.rule_id`.
- [ ] **Step 2: Apply** through the Management API (`jq -Rs '{query: .}' file.sql | curl ...`, see memory `project_mgmt_api_curl`), then insert the ledger row.
- [ ] **Step 3: Verify Spent matches the book.** Run `select project_name, sum(spent_hours) from retainer_budget('2026-10') group by 1` and compare three retainers against the Tracked column on `/retainers/book` for October. Expected: identical to 0.1h. A mismatch means the task set differs from the hook's; fix the function, not the comparison.
- [ ] **Step 4: Verify the invariants.** For `2026-10`: no negative `todo_hours`; no negative `alloc_hours`; and the function runs for a staff user (`begin; set local role authenticated; select count(*) from retainer_budget('2026-10'); rollback;` returns rows).
- [ ] **Step 5: Commit** `feat(budget): retainer_budget, one calculation for Budget/Spent/To do`.

### Task 2: Pure summary, verdict and department groups

**Files:**
- Create: `src/lib/retainer-budget.ts`, `src/lib/retainer-budget.test.ts`

**Interfaces:**
- Consumes: Task 1 row shape as `BudgetRow` (snake_case, numerics may arrive as strings: wrap in `Number()`).
- Produces:
  - `type DeptGroup = "dev" | "creative" | "seo" | "paid" | "social" | "strategy" | "admin" | "none"`
  - `DEPT_GROUP: Record<string, DeptGroup>` keyed by department name, covering all 19 live departments (Creative Production, Video / 3D / Motion Production, Content & Copywriting → creative; Social Media → social; Project Management, Client Meeting, Internal Meeting, Admin, Account Owner and every remaining non-delivery department → admin). `DEPT_GROUP_LABEL: Record<DeptGroup,string>` with "Admin & meetings" and "Not assigned".
  - `interface RetainerBudget { projectId; projectName; clientId; clientName; budget; spent; toDo; free; unspent; unestimated; departments: Array<{ group: DeptGroup; alloc: number; spent: number; toDo: number }> }` (numbers in hours; `free = budget − spent − toDo`, `unspent = budget − spent`).
  - `summariseBudget(rows: BudgetRow[]): RetainerBudget[]`, departments merged by group, sorted by budget descending.
  - `type BudgetVerdict = "fits" | "uses_todo" | "over_budget"`; `budgetVerdict(b: RetainerBudget, askHours: number): BudgetVerdict`: fits when `ask ≤ free`, uses_todo when `ask ≤ unspent`, else over_budget.
  - `currentBudgetMonth(now?: Date): string` in SAST.

- [ ] **Step 1: Write the failing tests.**
  - `summariseBudget` on two rows of one retainer (dev spent 3, creative to-do 2, budget 14.4) gives `free 9.4`, `unspent 11.4`.
  - Dovetail shape (budget 14.4, spent 4.5, to do 18.5): `free ≈ -8.6`; `budgetVerdict(b, 3) === "uses_todo"`; `budgetVerdict(b, 10) === "over_budget"`.
  - Pimms shape (budget 3.2, spent 3.2, to do 0): `budgetVerdict(b, 1) === "over_budget"`; `budgetVerdict(b, 0) === "fits"`.
  - Numeric strings (`"4.50"`) are summed as numbers.
  - `currentBudgetMonth(new Date("2026-10-31T23:30:00Z")) === "2026-11"` (01:30 SAST on 1 Nov).
  - Every live department maps: for each of the 19 names returned by `select name from departments where archived_at is null` (paste them into the test as a literal array), `DEPT_GROUP[name]` is defined.
- [ ] **Step 2:** `npx vitest run src/lib/retainer-budget.test.ts`: FAIL (module missing).
- [ ] **Step 3: Implement** the exports above.
- [ ] **Step 4:** same command: PASS.
- [ ] **Step 5: Commit** `feat(budget): summariseBudget and budgetVerdict`.

### Task 3: Hook and the bar component

**Files:**
- Create: `src/hooks/useRetainerBudget.ts`, `src/components/retainers/RetainerBudgetBar.tsx`, `src/components/retainers/RetainerBudgetBar.test.tsx`
- Modify: `tokens/base.json` (eight `color/dept-*` roles, Light and Dark), then `npm run tokens:build`; expose them in `tailwind.config.ts` as `bg-m-dept-<group>` / `border-m-dept-<group>`.

**Interfaces:**
- Consumes: Task 2 exports.
- Produces:
  - `useRetainerBudget(month: string, clientId?: string | null)` → `UseQueryResult<RetainerBudget[]>`, queryKey `["retainer_budget", month, clientId ?? null]`, calls `supabase.rpc("retainer_budget", { p_month, p_client_id })`, throws `errorMessage`-readable errors.
  - `<RetainerBudgetBar budget={RetainerBudget} askHours?={number} showDepartments?={boolean} />`.

Drawing rules (the artifact's `rBook` is the reference): one scale per bar, `end = max(budget, spent + toDo + ask)`. The box is the budget. Spent fills solid from the left by department group, To do follows as dashed blocks in the same colours, the ask follows as a striped amber block, the dark space left in the box is Free. Anything past the box is drawn faded with a red hatch. Right column: "{free}h free" (success), "Fully booked" (warning, |free| < 0.05), or "{-free}h short" (error), with "{unspent}h unspent" or "already {x}h over" under it. With `showDepartments`, a chip line under the bar: "{Group} {spent} + {toDo} / {alloc}", amber when spent + toDo > alloc, then "Not split {budget − Σalloc}", and a warning chip when Σalloc > budget. When `askHours > 0`, a verdict line from `budgetVerdict`: "Fits in Free. No approval needed." / "Only {free}h is free. The rest is already promised to work in To do." / "{x}h past the budget. Someone has to decide who pays." When `unestimated > 0`: "{n} open tasks have no estimate, so To do is understated."

- [ ] **Step 1: Write the failing tests** (Testing Library, no network): Dovetail-shaped budget renders text "8.6h short" and "9.9h unspent"; with `askHours={3}` renders "Only 0.0h is free"; Trellidor-shaped (52.5 / 29.7 / 7.3) with `askHours={2}` renders "15.5h free" and "Fits in Free"; `unestimated: 2` renders "2 open tasks have no estimate"; `showDepartments` with Σalloc 5.1 > budget 3.2 renders the warning chip.
- [ ] **Step 2:** `npx vitest run src/components/retainers/RetainerBudgetBar.test.tsx`: FAIL.
- [ ] **Step 3: Implement** the hook, tokens and component.
- [ ] **Step 4:** same command: PASS. `npm run typecheck`: 0 errors.
- [ ] **Step 5: Commit** `feat(budget): RetainerBudgetBar and useRetainerBudget`.

### Task 4: The request forms (step 1: show, decide nothing)

**Files:**
- Create: `src/components/retainers/ClientBudgetPanel.tsx`, `src/components/retainers/ClientBudgetPanel.test.tsx`
- Modify: `src/components/staff/ExtensionFormBody.tsx` (render the panel under the task picker), `src/components/staff/BriefFormBody.tsx` (under the hours field)

**Interfaces:**
- Consumes: `useRetainerBudget`, `RetainerBudgetBar`, `currentBudgetMonth`.
- Produces: `<ClientBudgetPanel clientId={string} clickupTaskId?={string | null} askHours={number} />`. Resolves the retainer by reading `briefs.parent_project_id` where `clickup_task_id = clickupTaskId`; if it matches a returned budget, renders only that bar; otherwise renders every budget for the client, each with its name, and the line "This task isn't linked to a retainer, so all of {client}'s retainers are shown." No budgets at all: "{client} has no retainer budget. This work is billed separately."

The extension form passes `askHours = Number(extraHours) || 0`; the brief form passes `askHours = Number(hours)` and no task id. Neither form's submit, tier or payload changes in this task.

- [ ] **Step 1: Write the failing tests** with `useRetainerBudget` and the brief lookup mocked: two budgets + a task id resolving to the second renders only the second's name (Review Focus 1); an unresolved task id renders both names and the "isn't linked" line (Review Focus 2); an empty list renders the "no retainer budget" line.
- [ ] **Step 2:** `npx vitest run src/components/retainers/ClientBudgetPanel.test.tsx`: FAIL.
- [ ] **Step 3: Implement** the panel and wire both forms.
- [ ] **Step 4:** tests PASS; then in the browser on the worktree dev server, sign in as `brendan@`, open `/staff`, pick Dovetail RSA on Extension request: the bar shows and reads "short". Screenshot it.
- [ ] **Step 5: Commit** `feat(budget): show the retainer budget on the request forms`.

### Task 5: Approvals and Escalations

**Files:**
- Modify: `src/components/approvals/RequestContext.tsx`, `src/pages/Escalations.tsx` (its detail pane), `src/pages/Approvals.test.tsx` only if its `RequestContext` mock needs the new prop.

**Interfaces:**
- Consumes: `ClientBudgetPanel`.

`RequestContext` already receives `taskId`, `requestedPoints` and `clientId`; render `<ClientBudgetPanel clientId={clientId} clickupTaskId={taskId} askHours={pointsToHours(requestedPoints ?? 0)} />` at its top. The Escalations detail pane renders the same panel from its `EscalationRow` (`client_id`, `parent_clickup_task_id`, `extra_points`). The bar is today's position, so label it "As it stands today", since the request may be days old.

- [ ] **Step 1: Write the failing test** in a new `src/components/approvals/RequestContext.test.tsx`: with the panel's hook mocked, a request of 12 points shows an ask of 3.0h on the bar.
- [ ] **Step 2:** run it: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS, and `npx vitest run src/pages/Approvals.test.tsx` still PASS.
- [ ] **Step 5: Commit** `feat(budget): approvers see the same bar the requester saw`.

### Task 6: Budgets on My work

**Files:**
- Create: `src/components/staff/MyBudgetsCard.tsx`, `src/components/staff/MyBudgetsCard.test.tsx`
- Modify: `src/pages/StaffBriefForm.tsx` (card above "Submit work")

**Interfaces:**
- Consumes: `useRetainerBudget(currentBudgetMonth())` (all clients), `useStaffClients()`.
- Produces: `<MyBudgetsCard />`: one `RetainerBudgetBar` per budgeted retainer of the clients in `useStaffClients()`, worst Free first, departments toggle off by default. Signed in as the shared login (`currentUserId` null), it shows every budgeted retainer.

- [ ] **Step 1: Write the failing tests:** given three budgets and staff clients covering two, renders two bars ordered by Free ascending; with `currentUserId` null renders all three (Review Focus 5).
- [ ] **Step 2:** run: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS; check `/staff` in the browser as `brendan@`.
- [ ] **Step 5: Commit** `feat(budget): everyone sees their clients' budgets on My work`.

### Task 7: Budget tab on the retainer book

**Files:**
- Create: `src/components/retainers/RetainerBudgetBoard.tsx`
- Modify: `src/pages/RetainersList.tsx` (`BookTab` gains `"budget"`; a `TabsTrigger value="budget">Budget` beside Split; render the board when selected)

**Interfaces:**
- Consumes: `useRetainerBudget(month)` with the page's existing month, `RetainerBudgetBar`.
- Produces: `<RetainerBudgetBoard month={string} />`: every budgeted retainer, a "Show each department's share" switch, sorted by Free ascending, plus one summary line: "{n} retainers short by {Σ}h. {m} with {Σ}h free."

- [ ] **Step 1: Write the failing test** `RetainerBudgetBoard.test.tsx`: with two budgets (one short 8.6, one free 15.5) the summary reads "1 retainer short by 8.6h. 1 with 15.5h free." and the short one is listed first.
- [ ] **Step 2:** run: FAIL.
- [ ] **Step 3: Implement.** Do not rename the book's existing Planned/Tracked columns in this task; that rename is a separate decision about a page Lisa reads daily.
- [ ] **Step 4:** PASS; open `/retainers/book` → Budget for October and confirm three retainers' Spent equal the Tracked tab's figures (the Task 1 invariant, now visible).
- [ ] **Step 5: Commit** `feat(budget): Budget tab on the retainer book`.

### Task 8: The tier follows the budget (rule change)

**Files:**
- Create: `supabase/migrations/0204_extension_tier_from_budget.sql`
- Modify: `src/types/extension-requests.ts` (add `tierFromBudget`), `src/components/staff/ExtensionFormBody.tsx`
- Test: `src/types/extension-requests.test.ts` (new)

**Interfaces:**
- Consumes: `retainer_budget`, `budgetVerdict`.
- Produces: `tierFromBudget(v: BudgetVerdict): ExtensionTier` (fits → auto, uses_todo → admin, over_budget → owner). Columns on `extension_requests`: `budget_project_id uuid`, `budget_free_hours numeric`, `budget_unspent_hours numeric` (the snapshot at the moment of asking).

Today the form computes `tier` and `status` in the browser and inserts them, and `approve-extension-request` trusts the row. A tier that decides money cannot be set by the requester, so the decision moves into a `before insert` trigger:
- Resolve the retainer from `briefs.parent_project_id` by `parent_clickup_task_id`; read its row from `retainer_budget(<SAST month of now()>, client_id)`.
- If found and `extra_points > 0`: points tier from the verdict on `extra_points * 0.25`; write the three snapshot columns.
- If not found (no budgeted retainer, unlinked task): keep the existing rule, `extra_points / original_points` with thresholds `< 25` auto, `≤ 50` admin, else owner.
- Due-date leg recomputed from `requested_due_date − original_due_date`: `≤ 2` days auto, `≤ 7` admin, else owner.
- `tier` = the stricter of the two legs; `status` = `auto_approved` for auto, else `pending_admin` (owner rows still enter at the admin leg, as `initialStatusForTier` does today). Whatever the client sent for `tier`, `status` and `delta_pct` is overwritten.

The form keeps its live preview, now from `tierFromBudget(budgetVerdict(...))` when a budget resolved, and after insert reads `tier` back (`.select("id, tier, status")`). Both follow-ups key off the **returned** row, not the preview: `approve-extension-request` only when it is `auto`, and the admin/owner notification and toast from its `tier`.

- [ ] **Step 1: Write the failing unit test:** `tierFromBudget("fits") === "auto"`, `"uses_todo"` → `"admin"`, `"over_budget"` → `"owner"`.
- [ ] **Step 2:** run: FAIL. **Step 3:** implement; PASS.
- [ ] **Step 4: Write and apply the trigger migration** (ledger row as in Task 1).
- [ ] **Step 5: Verify the trigger in a rolled-back transaction** through the Management API: `begin; insert into extension_requests (...) values (...client sends tier 'auto' with an ask larger than the retainer's unspent...) returning tier, status, budget_free_hours; rollback;`. Expected: `owner`, `pending_admin`, a non-null snapshot. Repeat with an ask inside Free: `auto`, `auto_approved`. Repeat with a task linked to no retainer and 10% of its points: `auto` via the old rule.
- [ ] **Step 6: Wire the form** and check in the browser that a small ask on a retainer with Free submits as auto and a large one shows "Goes to an admin" before submit.
- [ ] **Step 7: Commit** `feat(budget): extension tier is decided by what the retainer has free`, then run the full gates: `npm run verify`, `npm run lint:dead`, `npm run build`.

Nothing here deploys. Shipping is `npm run deploy` after the branch merges, and the two migrations are already live once applied, so apply 0204 only when the form change in Step 6 is merged and deployed the same day.
