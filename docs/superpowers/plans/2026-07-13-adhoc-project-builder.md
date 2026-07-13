# Adhoc Project Builder — Implementation Plan

**Goal:** A "+ New Project" button on the Projects page opens a single-panel builder to create a NON-recurring project for a client with multiple tasks. On Create: make a new ClickUp list in the client's folder, a parent umbrella task, one child task per row (right custom fields / points / assignee / status / BRIEF:: comment), record the project + a `project_actuals` row per task in Conductor, and navigate to the project.

**Decisions (confirmed by user):** new list per project; per-task fields = name/assignee/points/work stream/status/due date; single-panel form; create everything on Create with a running total.

**Reference files (mirror these — read them):**
- `supabase/functions/create-client-list/index.ts` — `POST /folder/{id}/list` + `client_lists` insert + orphan handling.
- `supabase/functions/create-retainer/index.ts` — orchestration skeleton: parent task create (status omitted), projects insert, delete-on-failure cleanup (`deleteClickupTask`). Also how `project_code` is generated + parent task fields.
- `supabase/functions/create-quick-brief-task/index.ts` — per-task: fetch `/list/{id}/field` → `buildBriefTaskBody` → status gate → points-cap retry → `BRIEF::` comment.
- `supabase/functions/create-recurring-tasks/index.ts` — multi-task loop; assignee resolution; `project_actuals` insert shape.
- `_shared/clickup.ts` — `buildBriefTaskBody`, `resolveDropdownOption`, `buildBriefComment`, `CuField`, `BriefTaskInput`.
- Frontend: `src/pages/Briefs.tsx` (+New button), `src/pages/NewBrief.tsx` (new-page + route pattern), `src/pages/Projects.tsx` (header), `src/components/QuickBriefSheet.tsx` (per-task pickers, sentinels, list-client-clickup-lists fetch), `src/hooks/useCreateQuickBriefTask.ts` (hook shape), `src/App.tsx` (routes — add `projects/new` BEFORE `projects/:id`).

## Global constraints
- Money int cents; 1 pt = 15 min (`POINT_TO_MIN`); ClickUp create OMITS status (CRTSK_001) except a real list status; dropdowns → option ids via `resolveDropdownOption` (FIELD_011); points-cap retry; orphan-on-failure surfaced not blind-retried.
- Edge fns deploy `--no-verify-jwt`; test with `deno check --node-modules-dir=auto` (revert deno.lock). Frontend vitest + `tsc -b` (ignore ~127 pre-existing errors).
- Adhoc project row: `is_recurring:false, recurrence_mode:"none", recurrence_interval:null, engagement_type:"project"` (distinct so no cron recurs it), `status:"in_progress"`, `clickup_list_id`, `clickup_parent_task_id` (NOT NULL), `project_code` (NOT NULL — generate the same way create-retainer does).

---

### Task 1: `create-adhoc-project` edge function
**File:** `supabase/functions/create-adhoc-project/index.ts`

**Request:** `POST { client_id, project_name, tasks: Array<{ task_name, assignee_member_id?: string|null, sprint_points: number, work_stream: string, status?: string, due_date?: string|null }> }`
**Response:** `200 { project_id, clickup_list_id, clickup_parent_task_id, created_task_ids: string[], task_failures?: [{task_name, error}] }` | `400/404/500/502 { error }`.

**Sequence (mirror create-retainer + create-client-list + create-quick-brief-task):**
1. Validate: client_id, project_name, tasks non-empty.
2. Load client (`id, name, clickup_client_name, clickup_folder_id`); 400 if no folder.
3. `POST /folder/{folder_id}/list { name: project_name }` → new list `{id,name}`. Insert a `client_lists` row (mirror create-client-list, incl. `group_id` handling + orphan return on DB failure).
4. Create the parent umbrella task in the new list (status omitted; mirror create-retainer's parent-task create) → `parent_task_id`.
5. Insert `projects` row: name, client_id, engagement_type "project", is_recurring false, recurrence_mode "none", status "in_progress", clickup_list_id, clickup_parent_task_id=parent_task_id, project_code (generate like create-retainer), due_date null. On failure → cleanup (delete parent task + list) and error.
6. Fetch the new list's fields once: `GET /list/{new_list_id}/field` → `CuField[]`.
7. For each task (sequential or bounded parallel): `buildBriefTaskBody(cuFields, { name, description: task_name, clientName: clickup_client_name ?? name, workStream, engagementType:"Task", sprintPoints, dateOfEngagement: today, assigneeClickupId: resolved, dueDateMs })` with `parent: parent_task_id` added to the body; set `taskBody.status` only if provided & valid; points-cap retry; `BRIEF::` comment (fire-and-forget); insert a `project_actuals` row (project_id, clickup_task_id, task_name, planned_hours = points*15/60, dept_id null). Collect failures into `task_failures` (don't abort the whole project on one task failure — the project + other tasks stand).
8. Return the ids. Resolve assignee_member_id → team_members.clickup_user_id (mirror create-quick-brief-task).

**Verify:** `deno check --node-modules-dir=auto`. No deploy (controller batches).

---

### Task 2: `useCreateAdhocProject` hook
**File:** `src/hooks/useCreateAdhocProject.ts` (+ test)
Mirror `useCreateQuickBriefTask.ts`. `CreateAdhocProjectArgs = { client_id, project_name, tasks: TaskInput[] }`. `functions.invoke("create-adhoc-project", { body })`; throw on transport error + `data.error`. onSuccess invalidate `["projects"]`. Test: forwards args verbatim; rejects on error.

---

### Task 3: `NewProjectWizard.tsx` page + button + route
**Files:** create `src/pages/NewProjectWizard.tsx`; modify `src/pages/Projects.tsx` (header button); modify `src/App.tsx` (lazy import + `projects/new` route BEFORE `projects/:id`).

- Projects.tsx: wrap the `<h1>Projects</h1>` header in a `flex items-center justify-between` and add `<Button asChild><Link to="/projects/new">+ New Project</Link></Button>` (mirror Briefs.tsx:124).
- App.tsx: `const NewProjectWizard = lazy(() => import("./pages/NewProjectWizard"))`; add `<Route path="projects/new" element={<NewProjectWizard/>}/>` BEFORE `projects/:id`.
- NewProjectWizard: single panel — client Select (`useClients`), project name input, then a repeatable list of task rows (+ Add task / remove). Each task row: name, assignee (`useTeam`), sprint points (min 1), work stream, status, due date. Source status + work_stream options from `list-client-clickup-lists { client_id }` (call it once when client picked — statuses from any sibling list, `work_stream_options` top-level; space-inherited so valid for the new list). Reuse QuickBriefSheet's sentinel patterns (`__unassigned__`, `__default__`) + auth'd fetch (`supabase.auth.getSession()` bearer). Show a running total: task count + summed sprint points. Guard: require client + project name + ≥1 task with a name; work stream valid per offered options. On Create → `useCreateAdhocProject().mutateAsync(...)`; on success toast + `navigate('/projects/${project_id}')`; surface `task_failures` if any (toast "project created, N tasks failed"). Follow M3 tokens; mirror QuickBriefSheet/NewRetainerWizard styling.

---

### Task 4: E2E verification (manual, real ClickUp)
Deploy `create-adhoc-project`. Create a small adhoc project on a safe/test client with 2 tasks; confirm: a new list appears in the client's folder, a parent task + 2 child tasks with correct work stream/points/status/assignee + BRIEF:: comments, the project shows on /projects, and `project_actuals` rows exist. Then wire deploy + merge.
