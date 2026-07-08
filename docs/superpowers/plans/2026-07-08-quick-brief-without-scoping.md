# Quick-Brief Without Scoping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator handle an inbound brief as a single ClickUp task with no scope/SOW/quote, AI-pre-classified with one-click override.

**Architecture:** The existing `auto-scope` edge fn classifies each brief; we add a `quick_task` bucket and have the same LLM call emit a persisted suggestion. The Inbox row + open brief show bucket-aware buttons. "Brief as-is" opens a confirm sheet prefilled from the suggestion; confirming calls a new `create-quick-brief-task` edge fn that reuses a shared single-task ClickUp helper (extracted from `approve-staff-brief`), flips the brief to `briefed`, and stores the task id/url.

**Tech Stack:** Supabase (Postgres + Deno edge functions), React 18 + TypeScript + TanStack Query + shadcn/ui, vitest (frontend) / `deno test` (edge shared logic).

**Spec:** `docs/superpowers/specs/2026-07-08-quick-brief-without-scoping-design.md`

## Global Constraints

- Money is `int` cents; hours `numeric(6,2)`; 1 sprint point = 15 minutes (`POINT_TO_MIN = 15`).
- Migrations apply via `mcp__cc-supabase__apply_migration` (name + SQL → timestamp version), **not** `supabase db push`. Local file is named `00XX_<name>.sql` for git sort order only.
- Edge functions deploy with `unset SUPABASE_ACCESS_TOKEN && supabase functions deploy <fn> --project-ref lpgwxacoqiqpcfpkklib --no-verify-jwt`.
- Edge-function code lives under `supabase/functions/**`, is **excluded from vitest**, and is tested with `deno test`. Frontend (`src/**`) is tested with `npm test` (vitest).
- Engagement Type custom field value for a quick task is the literal string `"Task"`.
- ClickUp task create must **omit** `status` (client spaces use custom status sets → CRTSK_001).
- Reuse `_shared/` helpers: `cors()`, `json()`, `createServiceRoleClient()`, `findCustomField()`, `buildBriefComment()`.
- Work in a git worktree created via `superpowers:using-git-worktrees`; copy `.env.local` from the main checkout (it is gitignored) and run any dev server on a distinct port.

---

### Task 1: Migration — `quick_task` intent, `briefed` status, suggestion + traceability columns

**Files:**
- Create: `supabase/migrations/0078_quick_brief.sql`

**Interfaces:**
- Produces: `briefs.intent_type` may equal `'quick_task'`; `briefs.status` may equal `'briefed'`; new nullable columns `briefs.quick_task_suggestion jsonb`, `briefs.clickup_task_id text`, `briefs.clickup_task_url text`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0078_quick_brief.sql`:

```sql
-- Quick-brief without scoping: new intent bucket + terminal status + task trace.

-- 1. Allow the quick_task intent value (intent_type is text + CHECK, not an enum).
alter table public.briefs drop constraint if exists briefs_intent_type_check;
alter table public.briefs add constraint briefs_intent_type_check
  check (intent_type = any (array[
    'new_brief', 'project_thread', 'retainer_thread',
    'general_query', 'quick_response', 'quick_task'
  ]::text[]));

-- 2. Add the 'briefed' terminal status to the brief_status enum.
alter type public.brief_status add value if not exists 'briefed';

-- 3. Traceability + AI suggestion payload for quick tasks.
alter table public.briefs
  add column if not exists quick_task_suggestion jsonb,
  add column if not exists clickup_task_id text,
  add column if not exists clickup_task_url text;

comment on column public.briefs.quick_task_suggestion is
  'AI-suggested confirm-sheet prefill for quick_task briefs: {task_name, work_stream, sprint_points, due_date, assignee_hint}.';
comment on column public.briefs.clickup_task_id is
  'ClickUp task id created when a brief is quick-briefed (status=briefed).';
```

- [ ] **Step 2: Apply the migration via MCP**

Apply with `mcp__cc-supabase__apply_migration`, `name: "quick_brief"`, `query:` the SQL above.

Note: `ALTER TYPE ... ADD VALUE` is allowed inside the migration because the new value is not *used* in the same transaction (only added).

- [ ] **Step 3: Verify the schema changes**

Run via `mcp__cc-supabase__execute_sql`:

```sql
select
  (select array_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid='public.brief_status'::regtype) as statuses,
  (select pg_get_constraintdef(oid) from pg_constraint where conname='briefs_intent_type_check') as intent_check,
  (select count(*) from information_schema.columns
     where table_name='briefs' and column_name in ('quick_task_suggestion','clickup_task_id','clickup_task_url')) as new_cols;
```

Expected: `statuses` includes `briefed`; `intent_check` includes `quick_task`; `new_cols` = 3.

- [ ] **Step 4: Regenerate DB types**

Run `mcp__cc-supabase__generate_typescript_types` and update `src/types/supabase.ts` (or the project's generated types file) if the repo tracks it. If the repo does not track generated types, skip.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0078_quick_brief.sql
git commit -m "feat(db): quick_task intent + briefed status + brief task-trace columns"
```

---

### Task 2: Classifier — add the `quick_task` bucket

**Files:**
- Modify: `supabase/functions/_shared/auto-scope-logic.ts`
- Test: `supabase/functions/_shared/auto-scope-logic.test.ts`

**Interfaces:**
- Consumes: existing `IntentType`, `VALID_INTENT_TYPES`, `parseClassifyResponse()`, `CLASSIFY_SYSTEM`, `buildScopeSystem()`.
- Produces: `IntentType` union now includes `"quick_task"`; `parseClassifyResponse("quick_task")` returns `"quick_task"`; `buildScopeSystem("quick_task")` returns a prompt that yields a suggestion JSON.

- [ ] **Step 1: Add the failing tests**

Append to `supabase/functions/_shared/auto-scope-logic.test.ts`:

```ts
Deno.test("parseClassifyResponse recognises quick_task", () => {
  assertEquals(parseClassifyResponse("quick_task"), "quick_task");
  assertEquals(parseClassifyResponse("  QUICK_TASK  "), "quick_task");
});

Deno.test("CLASSIFY_SYSTEM documents the quick_task bucket", () => {
  assert(CLASSIFY_SYSTEM.includes("quick_task"));
  assert(/one concrete|single deliverable|just do/i.test(CLASSIFY_SYSTEM));
});

Deno.test("buildScopeSystem for quick_task asks for a suggestion object", () => {
  const sys = buildScopeSystem("quick_task");
  assert(/sprint_points/.test(sys));
  assert(/work_stream/.test(sys));
});
```

(Ensure `assert` is imported alongside the existing `assertEquals` at the top of the test file:
`import { assert, assertEquals } from "jsr:@std/assert";` — match the existing import source already used in the file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/_shared/auto-scope-logic.test.ts`
Expected: FAIL — `quick_task` not in the union / prompt.

- [ ] **Step 3: Add `quick_task` to the type + validator**

In `supabase/functions/_shared/auto-scope-logic.ts`, extend the union and set:

```ts
export type IntentType =
  | "new_brief"
  | "project_thread"
  | "retainer_thread"
  | "general_query"
  | "quick_response"
  | "quick_task";

const VALID_INTENT_TYPES = new Set<string>([
  "new_brief",
  "project_thread",
  "retainer_thread",
  "general_query",
  "quick_response",
  "quick_task",
]);
```

- [ ] **Step 4: Extend the classify prompt with the boundary rule**

In the same file, add to the `CLASSIFY_SYSTEM` string (inside its bucket list) the quick_task definition and boundary, verbatim from the spec:

```
- quick_task: one concrete, self-evident deliverable a person can just do, with no estimation debate (e.g. "pull the discount report Jul-Mar", "add this redirect", "resize these 5 assets"). Choose quick_task over a scope intent when the work is a single obvious action; choose new_brief/project_thread/retainer_thread when effort, price, or SOW-fit is not obvious (e.g. "build us a landing page", "plan a campaign"). Choose quick_response over quick_task when there is no work to do, only a question to answer.
```

- [ ] **Step 5: Make `buildScopeSystem` emit a suggestion for quick_task**

In `buildScopeSystem(intentType)`, add a branch so that when `intentType === "quick_task"` the system prompt instructs Claude to return JSON:

```ts
if (intentType === "quick_task") {
  return [
    "You are scoping a QUICK TASK — a single concrete deliverable that will become one ClickUp task with no further scoping.",
    "Return ONLY a JSON object with these keys:",
    '{ "task_name": string (<= 80 chars, imperative), "work_stream": string (the delivery department, e.g. "SEO", "Paid Media", "Web", "Design", "Reporting"), "sprint_points": integer (1 point = 15 minutes; be realistic, minimum 1), "due_date": string|null (ISO yyyy-mm-dd if the message implies urgency or a deadline, else null), "assignee_hint": string|null (a role or name hint for who should do it, else null) }',
    "No prose, no markdown fences — just the JSON object.",
  ].join("\n");
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/auto-scope-logic.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/auto-scope-logic.ts supabase/functions/_shared/auto-scope-logic.test.ts
git commit -m "feat(auto-scope): add quick_task classifier bucket + suggestion prompt"
```

---

### Task 3: Persist the quick_task suggestion in `auto-scope`

**Files:**
- Modify: `supabase/functions/auto-scope/index.ts:133-170`

**Interfaces:**
- Consumes: `parseScopeJson()` output (`scopeData`), `intentType`.
- Produces: for `intent_type='quick_task'`, `briefs.quick_task_suggestion` is written and no `scopes` row is upserted.

- [ ] **Step 1: Branch the persistence on quick_task**

In `auto-scope/index.ts`, change the write block (currently lines 133-170) so the three buckets diverge. Replace the `draft_reply` line's ternary and the `if (intentType !== "quick_response")` guard with:

```ts
// 6. Write to DB
const quickTaskSuggestion =
  intentType === "quick_task" ? scopeData : null;

const { error: updateErr } = await supabase
  .from("briefs")
  .update({
    intent_type: intentType,
    draft_reply: intentType === "quick_response"
      ? (typeof scopeData.draft_reply === "string" ? scopeData.draft_reply : null)
      : null,
    quick_task_suggestion: quickTaskSuggestion,
    status: "triaged",
    updated_at: new Date().toISOString(),
  })
  .eq("id", brief_id);
if (updateErr) console.error("[auto-scope] briefs update failed:", updateErr.message);

// Only the scope-requiring intents get a scopes row.
if (intentType !== "quick_response" && intentType !== "quick_task") {
  // ... existing scopes upsert unchanged ...
}
```

Keep the existing scopes-upsert body exactly as-is inside the new guard.

- [ ] **Step 2: Typecheck the function locally**

Run: `deno check supabase/functions/auto-scope/index.ts`
Expected: no errors.

- [ ] **Step 3: Deploy auto-scope**

Run: `unset SUPABASE_ACCESS_TOKEN && supabase functions deploy auto-scope --project-ref lpgwxacoqiqpcfpkklib --no-verify-jwt`
Expected: `Deployed Functions on project lpgwxacoqiqpcfpkklib: auto-scope`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/auto-scope/index.ts
git commit -m "feat(auto-scope): persist quick_task suggestion, skip scopes row"
```

---

### Task 4: Shared single-task ClickUp helper

**Files:**
- Modify: `supabase/functions/_shared/clickup.ts`
- Test: `supabase/functions/_shared/clickup.test.ts`
- Modify: `supabase/functions/approve-staff-brief/index.ts` (refactor to use the helper)

**Interfaces:**
- Produces:
```ts
export type BriefTaskInput = {
  listId: string;
  name: string;
  description: string;
  clientName: string;
  workStream: string;
  engagementType: string;   // "Task" | "Project"
  sprintPoints: number;
  dateOfEngagement: string;  // yyyy-mm-dd
  assigneeClickupId?: number | null;
  dueDateMs?: number | null;
};
export function buildBriefTaskBody(
  cuFields: Array<{ id: string; name: string; type: string }>,
  input: BriefTaskInput,
): Record<string, unknown>;
```
`buildBriefTaskBody` returns the ClickUp create body (name, description, `time_estimate`, `custom_fields`, optional `assignees`, optional `due_date`) — omitting `status`. It is pure (no fetch), so it is unit-testable; the calling edge fn does the actual POST.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/clickup.test.ts`:

```ts
Deno.test("buildBriefTaskBody fills custom fields + time estimate, omits status", () => {
  const fields = [
    { id: "f_client", name: "Client Name", type: "drop_down" },
    { id: "f_doe", name: "Date of Engagement", type: "date" },
    { id: "f_et", name: "Engagement Type", type: "drop_down" },
    { id: "f_ws", name: "Work Stream", type: "drop_down" },
    { id: "f_pts", name: "Sprint Points", type: "number" },
  ];
  const body = buildBriefTaskBody(fields, {
    listId: "L1", name: "Pull discount report", description: "d",
    clientName: "Trellidor", workStream: "Reporting", engagementType: "Task",
    sprintPoints: 4, dateOfEngagement: "2026-07-08", assigneeClickupId: 99,
    dueDateMs: null,
  });
  assertEquals(body.name, "Pull discount report");
  assertEquals(body.time_estimate, 4 * 15 * 60_000);
  assertEquals((body as { status?: unknown }).status, undefined);
  assertEquals((body as { assignees: number[] }).assignees, [99]);
  const cf = body.custom_fields as Array<{ id: string; value: unknown }>;
  assertEquals(cf.find((c) => c.id === "f_client")?.value, "Trellidor");
  assertEquals(cf.find((c) => c.id === "f_et")?.value, "Task");
  assertEquals(cf.find((c) => c.id === "f_pts")?.value, 4);
});

Deno.test("buildBriefTaskBody omits assignees when none + sets due_date when given", () => {
  const body = buildBriefTaskBody([], {
    listId: "L1", name: "n", description: "d", clientName: "C",
    workStream: "W", engagementType: "Task", sprintPoints: 1,
    dateOfEngagement: "2026-07-08", assigneeClickupId: null, dueDateMs: 1780000000000,
  });
  assertEquals((body as { assignees?: unknown }).assignees, undefined);
  assertEquals((body as { due_date?: number }).due_date, 1780000000000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/clickup.test.ts`
Expected: FAIL — `buildBriefTaskBody` not defined.

- [ ] **Step 3: Implement the helper**

Add to `supabase/functions/_shared/clickup.ts` (reuse the existing `findCustomField`; keep the `POINT_TO_MIN = 15` convention local):

```ts
const POINT_TO_MIN = 15;

export type BriefTaskInput = {
  listId: string;
  name: string;
  description: string;
  clientName: string;
  workStream: string;
  engagementType: string;
  sprintPoints: number;
  dateOfEngagement: string;
  assigneeClickupId?: number | null;
  dueDateMs?: number | null;
};

export function buildBriefTaskBody(
  cuFields: Array<{ id: string; name: string; type: string }>,
  input: BriefTaskInput,
): Record<string, unknown> {
  const cf: Array<{ id: string; value: unknown }> = [];
  const client = findCustomField(cuFields, "Client Name");
  if (client) cf.push({ id: client.id, value: input.clientName });
  const doe = findCustomField(cuFields, "Date of Engagement");
  if (doe) {
    cf.push({
      id: doe.id,
      value: Date.UTC(
        Number(input.dateOfEngagement.slice(0, 4)),
        Number(input.dateOfEngagement.slice(5, 7)) - 1,
        Number(input.dateOfEngagement.slice(8, 10)),
      ),
    });
  }
  const et = findCustomField(cuFields, "Engagement Type");
  if (et) cf.push({ id: et.id, value: input.engagementType });
  const ws = findCustomField(cuFields, "Work Stream");
  if (ws) cf.push({ id: ws.id, value: input.workStream });
  const pts = findCustomField(cuFields, "Sprint Points");
  if (pts) cf.push({ id: pts.id, value: input.sprintPoints });

  const body: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    time_estimate: Math.round(input.sprintPoints * POINT_TO_MIN * 60_000),
    custom_fields: cf,
  };
  if (input.assigneeClickupId) body.assignees = [input.assigneeClickupId];
  if (input.dueDateMs) { body.due_date = input.dueDateMs; body.due_date_time = false; }
  return body;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/clickup.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `approve-staff-brief` to use the helper**

In `approve-staff-brief/index.ts`, replace the inline `customFieldsPayload` + `taskBody` construction (lines ~136-168) with:

```ts
import { buildBriefComment, findCustomField, buildBriefTaskBody } from "../_shared/clickup.ts";
// ...
const taskBody = buildBriefTaskBody(cuFields, {
  listId: brief.clickup_list_id,
  name: brief.task_name,
  description,
  clientName: cli.name,
  workStream,
  engagementType,
  sprintPoints: brief.sprint_points,
  dateOfEngagement,
  assigneeClickupId: member.clickup_user_id,
  dueDateMs: null,
});
```

Leave the create POST, comment, and DB update untouched.

- [ ] **Step 6: Typecheck + deploy approve-staff-brief**

Run: `deno check supabase/functions/approve-staff-brief/index.ts`
Run: `unset SUPABASE_ACCESS_TOKEN && supabase functions deploy approve-staff-brief --project-ref lpgwxacoqiqpcfpkklib --no-verify-jwt`
Expected: no type errors; deploy success.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/clickup.ts supabase/functions/_shared/clickup.test.ts supabase/functions/approve-staff-brief/index.ts
git commit -m "refactor(clickup): extract buildBriefTaskBody, reuse in approve-staff-brief"
```

---

### Task 5: `create-quick-brief-task` edge function

**Files:**
- Create: `supabase/functions/create-quick-brief-task/index.ts`

**Interfaces:**
- Consumes: `buildBriefTaskBody`, `buildBriefComment`, `createServiceRoleClient`, `cors`, `json`.
- Request: `POST { brief_id, task_name, assignee_member_id?, sprint_points, work_stream, due_date? }` (due_date = `yyyy-mm-dd`|null).
- Response: `200 { clickup_task_id, clickup_task_url }` | `400/404/409/502 { error }`.

- [ ] **Step 1: Implement the function**

Create `supabase/functions/create-quick-brief-task/index.ts`:

```ts
// supabase/functions/create-quick-brief-task/index.ts
//
// Request:  POST { brief_id, task_name, assignee_member_id?, sprint_points,
//                  work_stream, due_date? }
// Response: 200 { clickup_task_id, clickup_task_url }
//
// Turns a brief into ONE ClickUp task with no scope/SOW/quote. Idempotent:
// if the brief already has a clickup_task_id, returns it unchanged.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { buildBriefComment, buildBriefTaskBody } from "../_shared/clickup.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const b = (await req.json()) as {
      brief_id?: string; task_name?: string; assignee_member_id?: string | null;
      sprint_points?: number; work_stream?: string; due_date?: string | null;
    };
    if (!b.brief_id || !b.task_name || !b.work_stream || !b.sprint_points) {
      return json({ error: "brief_id, task_name, work_stream, sprint_points required" }, 400);
    }
    const sb = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: brief, error: bErr } = await sb
      .from("briefs")
      .select("id, raw_subject, raw_body, status, clickup_task_id, clickup_task_url, client:clients(id, name, clickup_folder_id)")
      .eq("id", b.brief_id)
      .single();
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    // Idempotency
    if (brief.clickup_task_id) {
      return json({ clickup_task_id: brief.clickup_task_id, clickup_task_url: brief.clickup_task_url, already_briefed: true });
    }

    const client = (brief as { client?: { id: string; name: string; clickup_folder_id: string | null } | null }).client;
    if (!client) return json({ error: "Brief has no client — assign a client first." }, 400);
    if (!client.clickup_folder_id) return json({ error: `Client ${client.name} has no ClickUp folder configured.` }, 400);

    // Resolve the target list: the "projects" list in the client's folder, else the first list.
    const listsRes = await fetch(
      `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (!listsRes.ok) return json({ error: `ClickUp lists ${listsRes.status}: ${await listsRes.text()}` }, 502);
    const lists = ((await listsRes.json()).lists ?? []) as Array<{ id: string; name: string }>;
    if (lists.length === 0) return json({ error: `Client ${client.name} folder has no lists.` }, 400);
    const list = lists.find((l) => /project/i.test(l.name)) ?? lists[0];

    // Resolve assignee → clickup_user_id.
    let assigneeClickupId: number | null = null;
    if (b.assignee_member_id) {
      const { data: m } = await sb.from("team_members").select("clickup_user_id").eq("id", b.assignee_member_id).maybeSingle();
      assigneeClickupId = (m as { clickup_user_id: number | null } | null)?.clickup_user_id ?? null;
    }

    // Custom field defs for the list.
    const CU = { headers: { Authorization: clickupPat, "Content-Type": "application/json" } };
    const fieldsRes = await fetch(`https://api.clickup.com/api/v2/list/${list.id}/field`, CU);
    if (!fieldsRes.ok) return json({ error: `ClickUp fields ${fieldsRes.status}: ${await fieldsRes.text()}` }, 502);
    const cuFields = ((await fieldsRes.json()).fields ?? []) as Array<{ id: string; name: string; type: string }>;

    const dateOfEngagement = new Date().toISOString().slice(0, 10);
    const dueDateMs = b.due_date ? Date.parse(b.due_date) : null;
    const description =
      `${b.task_name}\n\n${brief.raw_body ?? ""}\n\n---\n` +
      `_Quick-briefed from inbox brief ${brief.id} on ${dateOfEngagement}._`;

    const taskBody = buildBriefTaskBody(cuFields, {
      listId: list.id, name: b.task_name, description,
      clientName: client.name, workStream: b.work_stream, engagementType: "Task",
      sprintPoints: b.sprint_points, dateOfEngagement, assigneeClickupId, dueDateMs,
    });

    const createRes = await fetch(`https://api.clickup.com/api/v2/list/${list.id}/task`, {
      ...CU, method: "POST", body: JSON.stringify(taskBody),
    });
    if (!createRes.ok) return json({ error: `ClickUp create ${createRes.status}: ${await createRes.text()}` }, 502);
    const created = (await createRes.json()) as { id: string; url: string };

    const comment = buildBriefComment({
      client_name: client.name, engagement_type: "Task", work_stream: b.work_stream,
      sprint_points: b.sprint_points, date_of_engagement: dateOfEngagement,
      source_quote_id: `quick_brief:${brief.id}`,
    });
    await fetch(`https://api.clickup.com/api/v2/task/${created.id}/comment`, {
      ...CU, method: "POST", body: JSON.stringify({ comment_text: comment, notify_all: false }),
    });

    const { error: upErr } = await sb.from("briefs").update({
      status: "briefed", clickup_task_id: created.id, clickup_task_url: created.url,
      updated_at: new Date().toISOString(),
    }).eq("id", brief.id);
    if (upErr) {
      return json({ error: `Task ${created.id} created but DB update failed: ${upErr.message}`, clickup_task_id: created.id, clickup_task_url: created.url }, 500);
    }
    return json({ clickup_task_id: created.id, clickup_task_url: created.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/create-quick-brief-task/index.ts`
Expected: no errors.

- [ ] **Step 3: Deploy**

Run: `unset SUPABASE_ACCESS_TOKEN && supabase functions deploy create-quick-brief-task --project-ref lpgwxacoqiqpcfpkklib --no-verify-jwt`
Expected: deploy success.

- [ ] **Step 4: Smoke test the guard paths (no ClickUp write)**

Using a brief with no client, POST to the function URL with `apikey`+`Authorization` = anon key (verify_jwt is off). Expected: `400 { error: "Brief has no client..." }`. Do NOT run a create against a real client until the frontend confirm step exists (Task 7) — avoids stray tasks.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/create-quick-brief-task/index.ts
git commit -m "feat(edge): create-quick-brief-task — single ClickUp task from a brief"
```

---

### Task 6: Suggestion normaliser (pure, frontend)

**Files:**
- Create: `src/lib/quick-brief-suggestion.ts`
- Test: `src/lib/quick-brief-suggestion.test.ts`

**Interfaces:**
- Produces:
```ts
export type QuickTaskSuggestion = {
  task_name?: unknown; work_stream?: unknown;
  sprint_points?: unknown; due_date?: unknown; assignee_hint?: unknown;
};
export type QuickBriefDraft = {
  task_name: string; work_stream: string; sprint_points: number; due_date: string | null;
};
export function draftFromSuggestion(
  suggestion: QuickTaskSuggestion | null,
  fallbackSubject: string,
): QuickBriefDraft;
```
Normalises the persisted `quick_task_suggestion` into safe, always-present form values: name falls back to subject, work_stream to `""`, points floored to `>= 1` integer, due_date validated as `yyyy-mm-dd` or `null`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/quick-brief-suggestion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { draftFromSuggestion } from "./quick-brief-suggestion";

describe("draftFromSuggestion", () => {
  it("uses suggestion values when valid", () => {
    expect(draftFromSuggestion(
      { task_name: "Pull report", work_stream: "Reporting", sprint_points: 4, due_date: "2026-07-15" },
      "Re: report",
    )).toEqual({ task_name: "Pull report", work_stream: "Reporting", sprint_points: 4, due_date: "2026-07-15" });
  });

  it("falls back to subject and safe defaults when null", () => {
    expect(draftFromSuggestion(null, "Discount App report")).toEqual({
      task_name: "Discount App report", work_stream: "", sprint_points: 1, due_date: null,
    });
  });

  it("floors points to an integer >= 1 and rejects bad dates", () => {
    const d = draftFromSuggestion(
      { task_name: "", sprint_points: 0.4, due_date: "not-a-date" }, "Subj",
    );
    expect(d.sprint_points).toBe(1);
    expect(d.due_date).toBeNull();
    expect(d.task_name).toBe("Subj");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/quick-brief-suggestion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/quick-brief-suggestion.ts`:

```ts
export type QuickTaskSuggestion = {
  task_name?: unknown; work_stream?: unknown;
  sprint_points?: unknown; due_date?: unknown; assignee_hint?: unknown;
};
export type QuickBriefDraft = {
  task_name: string; work_stream: string; sprint_points: number; due_date: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

export function draftFromSuggestion(
  suggestion: QuickTaskSuggestion | null,
  fallbackSubject: string,
): QuickBriefDraft {
  const s = suggestion ?? {};
  const pointsRaw = typeof s.sprint_points === "number" ? s.sprint_points : Number(s.sprint_points);
  const sprint_points = Number.isFinite(pointsRaw) ? Math.max(1, Math.round(pointsRaw)) : 1;
  const due =
    typeof s.due_date === "string" && ISO_DATE.test(s.due_date) && !Number.isNaN(Date.parse(s.due_date))
      ? s.due_date
      : null;
  return {
    task_name: str(s.task_name, fallbackSubject || "Untitled task"),
    work_stream: str(s.work_stream, ""),
    sprint_points,
    due_date: due,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/lib/quick-brief-suggestion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quick-brief-suggestion.ts src/lib/quick-brief-suggestion.test.ts
git commit -m "feat(briefs): pure quick-brief suggestion normaliser"
```

---

### Task 7: `useCreateQuickBriefTask` mutation hook

**Files:**
- Create: `src/hooks/useCreateQuickBriefTask.ts`
- Test: `src/hooks/useCreateQuickBriefTask.test.ts`

**Interfaces:**
- Consumes: the `create-quick-brief-task` edge fn; the project's supabase client (`src/lib/supabase.ts`) and its `functions.invoke` wrapper (follow the pattern in an existing hook such as `src/hooks/useAssignBriefToProject.ts`).
- Produces:
```ts
export type CreateQuickBriefArgs = {
  brief_id: string; task_name: string; assignee_member_id: string | null;
  sprint_points: number; work_stream: string; due_date: string | null;
};
export function useCreateQuickBriefTask(): UseMutationResult<
  { clickup_task_id: string; clickup_task_url: string }, Error, CreateQuickBriefArgs>;
```
On success it invalidates the briefs/inbox query keys so the row leaves the "new" list.

- [ ] **Step 1: Read an existing brief mutation hook for the exact client + invalidation pattern**

Read `src/hooks/useAssignBriefToProject.ts` in full. Match its supabase-client import, `functions.invoke` error handling, and `queryClient.invalidateQueries` keys.

- [ ] **Step 2: Write the failing test**

Create `src/hooks/useCreateQuickBriefTask.test.ts` following the structure of `src/hooks/useAssignBriefToProject.test.ts` (same QueryClient wrapper + mocked supabase). Assert that calling `mutateAsync` invokes `functions.invoke("create-quick-brief-task", { body })` with the exact args, and that a thrown edge error rejects.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
// ...mirror the mocking setup used in useAssignBriefToProject.test.ts...

it("invokes the edge fn with the confirmed values", async () => {
  invokeMock.mockResolvedValue({ data: { clickup_task_id: "t1", clickup_task_url: "u" }, error: null });
  const { result } = renderHook(() => useCreateQuickBriefTask(), { wrapper });
  await result.current.mutateAsync({
    brief_id: "b1", task_name: "Do it", assignee_member_id: null,
    sprint_points: 2, work_stream: "Reporting", due_date: null,
  });
  expect(invokeMock).toHaveBeenCalledWith("create-quick-brief-task", {
    body: { brief_id: "b1", task_name: "Do it", assignee_member_id: null, sprint_points: 2, work_stream: "Reporting", due_date: null },
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/hooks/useCreateQuickBriefTask.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the hook**

Create `src/hooks/useCreateQuickBriefTask.ts` mirroring `useAssignBriefToProject.ts`:

```ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type CreateQuickBriefArgs = {
  brief_id: string; task_name: string; assignee_member_id: string | null;
  sprint_points: number; work_stream: string; due_date: string | null;
};
type CreateQuickBriefResult = { clickup_task_id: string; clickup_task_url: string };

export function useCreateQuickBriefTask(): UseMutationResult<CreateQuickBriefResult, Error, CreateQuickBriefArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateQuickBriefArgs) => {
      const { data, error } = await supabase.functions.invoke("create-quick-brief-task", { body: args });
      if (error) throw new Error(error.message ?? "Quick-brief failed");
      const d = data as CreateQuickBriefResult & { error?: string };
      if (d?.error) throw new Error(d.error);
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}
```

(Adjust the invalidation keys to match the actual keys used by the Inbox/Briefs queries — confirm them while reading Task 8's files.)

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- src/hooks/useCreateQuickBriefTask.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCreateQuickBriefTask.ts src/hooks/useCreateQuickBriefTask.test.ts
git commit -m "feat(briefs): useCreateQuickBriefTask mutation hook"
```

---

### Task 8: Confirm sheet + bucket-aware buttons (UI)

**Files:**
- Create: `src/components/QuickBriefSheet.tsx`
- Create: `src/components/BriefHandlingButtons.tsx`
- Test: `src/components/BriefHandlingButtons.test.tsx`
- Modify: `src/components/BriefRow.tsx` (render the buttons)
- Modify: `src/pages/Scope.tsx` (offer "Brief as-is" inside the open brief)

**Interfaces:**
- Consumes: `draftFromSuggestion` (Task 6), `useCreateQuickBriefTask` (Task 7), the brief shape (`intent_type`, `quick_task_suggestion`, `raw_subject`, `client`), the team roster query, the work-stream/department options.
- Produces:
```ts
// BriefHandlingButtons: given a brief, renders primary+secondary by bucket.
export function pickPrimary(intent: string | null): "brief_as_is" | "scope_it" | "draft_reply";
export function BriefHandlingButtons(props: {
  brief: BriefRowBrief;
  onScopeIt: () => void;
  onBriefAsIs: () => void;
  onDraftReply?: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing test for `pickPrimary`**

Create `src/components/BriefHandlingButtons.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { pickPrimary } from "./BriefHandlingButtons";

describe("pickPrimary", () => {
  it("quick_task → brief_as_is", () => expect(pickPrimary("quick_task")).toBe("brief_as_is"));
  it("quick_response → draft_reply", () => expect(pickPrimary("quick_response")).toBe("draft_reply"));
  it("general_query → draft_reply", () => expect(pickPrimary("general_query")).toBe("draft_reply"));
  it("new_brief → scope_it", () => expect(pickPrimary("new_brief")).toBe("scope_it"));
  it("null → scope_it", () => expect(pickPrimary(null)).toBe("scope_it"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/components/BriefHandlingButtons.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pickPrimary` + `BriefHandlingButtons`**

Create `src/components/BriefHandlingButtons.tsx`. `pickPrimary` maps intent → primary action; the component renders the primary button prominently and the other two as secondary (all three always clickable so the AI is always overridable). Use existing shadcn `Button` variants (`default` for primary, `outline`/`ghost` for secondary).

```tsx
import { Button } from "@/components/ui/button";

export type BriefRowBrief = { id: string; intent_type: string | null };

export function pickPrimary(intent: string | null): "brief_as_is" | "scope_it" | "draft_reply" {
  if (intent === "quick_task") return "brief_as_is";
  if (intent === "quick_response" || intent === "general_query") return "draft_reply";
  return "scope_it";
}

export function BriefHandlingButtons({
  brief, onScopeIt, onBriefAsIs, onDraftReply,
}: {
  brief: BriefRowBrief;
  onScopeIt: () => void;
  onBriefAsIs: () => void;
  onDraftReply?: () => void;
}) {
  const primary = pickPrimary(brief.intent_type);
  const btn = (key: "brief_as_is" | "scope_it" | "draft_reply", label: string, onClick: () => void) => (
    <Button variant={primary === key ? "default" : "outline"} size="sm" onClick={onClick}>{label}</Button>
  );
  return (
    <div className="flex gap-2">
      {btn("brief_as_is", "Brief as-is", onBriefAsIs)}
      {btn("scope_it", "Scope it", onScopeIt)}
      {onDraftReply && btn("draft_reply", "Draft reply", onDraftReply)}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/components/BriefHandlingButtons.test.tsx`
Expected: PASS.

- [ ] **Step 5: Build the `QuickBriefSheet`**

Create `src/components/QuickBriefSheet.tsx` — a shadcn `Sheet`/`Dialog` prefilled via `draftFromSuggestion(brief.quick_task_suggestion, brief.raw_subject)`. Fields: task name (input), assignee (select from team roster), sprint points (number), work stream (select from department options), due date (date input). Guard: if `!brief.client_id`, disable Create and show "Assign a client first." On Create call `useCreateQuickBriefTask().mutateAsync(...)`; on success toast + close. Follow the styling of an existing sheet/dialog in the repo (e.g. the estimate sheet `src/components/EstimateSheet.tsx`) for tokens and layout.

- [ ] **Step 6: Wire into `BriefRow` and the open brief**

In `src/components/BriefRow.tsx`, render `<BriefHandlingButtons>` with `onScopeIt` = the existing accept-and-navigate handler, `onBriefAsIs` = open `QuickBriefSheet`, `onDraftReply` = the existing draft path (or navigate to the reply view). In `src/pages/Scope.tsx`, add a secondary "Brief as-is" affordance that opens the same `QuickBriefSheet`, so a brief can be downgraded mid-review.

- [ ] **Step 7: Component render test for the guard**

Add to `src/components/BriefHandlingButtons.test.tsx` (or a `QuickBriefSheet.test.tsx`) a render test: a brief with no `client_id` renders the Create button disabled with the "Assign a client first" message. Use `@testing-library/react` as the existing component tests do.

Run: `npm test -- src/components`
Expected: PASS.

- [ ] **Step 8: Typecheck the whole frontend**

Run: `npm run typecheck`
Expected: no NEW errors in the files created/modified here (the repo has ~pre-existing errors in unrelated files; do not fix those — just confirm none are in Task 8 files).

- [ ] **Step 9: Commit**

```bash
git add src/components/QuickBriefSheet.tsx src/components/BriefHandlingButtons.tsx src/components/BriefHandlingButtons.test.tsx src/components/BriefRow.tsx src/pages/Scope.tsx
git commit -m "feat(briefs): bucket-aware handling buttons + quick-brief confirm sheet"
```

---

### Task 9: End-to-end verification (manual, real ClickUp)

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend + edge test suites**

Run: `npm test`
Run: `deno test supabase/functions/_shared/`
Expected: all pass.

- [ ] **Step 2: Live smoke against a safe brief**

In the app (dev server on a distinct port, `.env.local` copied into the worktree), open a `quick_task`-classified brief with a real client (use the Trellidor "Discount App report" brief `d78e9650-b714-4571-bfa0-ddceac09eb75`). Click "Brief as-is", eyeball the prefill, Create. Confirm: one ClickUp task appears in the client's projects list with Client/Date/Engagement Type=Task/Work Stream/points + a `BRIEF::` comment; the brief flips to `briefed` and stores `clickup_task_id`.

- [ ] **Step 3: Idempotency check**

Trigger Create again on the same brief (or re-POST). Expected: `already_briefed: true`, no second ClickUp task.

- [ ] **Step 4: Commit any final fixes + open PR**

Use `superpowers:finishing-a-development-branch` to merge the worktree branch back or open a PR.

---

## Self-Review

**Spec coverage:**
- 3 buckets + boundary rule → Task 2. ✅
- `quick_task` intent + `briefed` status + trace columns → Task 1. ✅
- Hybrid classify (extend auto-scope, no new fn) → Tasks 2–3. ✅
- Bucket-aware buttons (inbox + open brief) → Task 8. ✅
- Confirm sheet, AI-prefilled + editable → Tasks 6, 8. ✅
- Create single ClickUp task reusing approve-staff-brief machinery → Tasks 4, 5. ✅
- Edge cases (no client, no folder, idempotency) → Task 5 (guards) + Task 8 (UI guard). ✅
- Rollout behind ClickUp settings gate → inherited from `approve-staff-brief`/`push-to-clickup` env gating; no new UI toggle needed (noted).
- Estimate/assignee/work-stream/due sourcing → Task 2 (LLM emits), Task 6 (normalise), Task 8 (edit). ✅

**Deviation from spec (flag to user):** the spec listed *two* new columns; this plan adds a *third*, `quick_task_suggestion jsonb`, so the AI prefill is produced by the existing auto-scope LLM call and persisted (no extra UI-time LLM round-trip). Everything else matches.

**Placeholder scan:** No TBD/TODO; every code step has complete code. Two steps intentionally say "mirror existing file X" (Task 7 hook, Task 8 sheet styling) — these point at named, existing files to copy patterns from, not vague instructions.

**Type consistency:** `buildBriefTaskBody(cuFields, BriefTaskInput)` is defined in Task 4 and consumed identically in Tasks 4 (approve-staff-brief) and 5 (edge fn). `draftFromSuggestion` (Task 6) → `QuickBriefDraft` consumed in Task 8. `CreateQuickBriefArgs` (Task 7) matches the edge fn request body in Task 5. `pickPrimary` return union consistent across Task 8.
