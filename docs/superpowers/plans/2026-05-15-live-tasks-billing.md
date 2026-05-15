# Live Tasks Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing perpetual "ongoing tasks" into invoiceable "live tasks" by adding a `billable` flag (sourced from ClickUp's native billable toggle), reclassifying the productivity dashboard on that flag, and emitting Xero line items at the assignee's department rate.

**Architecture:** Add `billable` to `time_categories` (default) with a nullable override on `ongoing_tasks`. Push that flag through to ClickUp on provision. Re-classify `get-productivity` by `entry.billable` rather than by `ongoing_tasks` membership. Add a SQL view that aggregates billable time entries by (client × member × period) and a new `build-live-invoice` edge function that multiplies by `team_members.primary_department_id → departments.hourly_rate_cents` and emits Xero-shaped line items. Surface billable badges + a period invoice preview in `/scaffold/live-tasks`.

**Tech Stack:** Supabase Postgres migrations, Deno edge functions, React 18 + TypeScript + TanStack Query + shadcn/ui, ClickUp v2 API, Xero API.

**Verification model:** This repo has no automated test harness. Each task ends with a concrete verification step — a SQL query, curl, or browser check — that must produce the expected result before committing.

---

## File Structure

**New files**
- `supabase/migrations/0050_live_tasks_billable.sql` — `billable` columns + backfill.
- `supabase/migrations/0051_live_actuals_view.sql` — `live_actuals_by_period` view.
- `supabase/functions/build-live-invoice/index.ts` — period rollup → Xero line items.
- `src/pages/LiveTasksInvoicePreview.tsx` — Scaffold sub-page for period preview.
- `src/components/scaffold/BillableBadge.tsx` — small reusable badge.

**Modified files**
- `supabase/functions/provision-ongoing-tasks/index.ts` — resolve billable, send to ClickUp.
- `supabase/functions/sync-clickup-actuals/index.ts` — verify per-entry `billable` survives in `ongoing_actuals.time_entries` JSON.
- `supabase/functions/get-productivity/index.ts` — classify by `entry.billable` (TS shape gains optional `billable`).
- `src/pages/OngoingTasksPlanner.tsx` — billable badge per template + per-cell rate.
- `src/App.tsx` — register `/scaffold/live-tasks/invoice-preview` route.
- `src/components/AppShell.tsx` (or wherever Scaffold sub-nav lives) — link to invoice preview.

---

## Task 1: Add `billable` columns to schema

**Files:**
- Create: `supabase/migrations/0050_live_tasks_billable.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0050_live_tasks_billable.sql
--
-- Live-task billing flag. time_categories.billable is the default for
-- every (member × client × template) cell; ongoing_tasks.billable is a
-- nullable per-row override. NULL on ongoing_tasks => inherit from the
-- category. We mirror this flag to ClickUp's native billable toggle on
-- the task at provision time so ClickUp and our DB stay in sync.

alter table public.time_categories
  add column if not exists billable boolean not null default false;

comment on column public.time_categories.billable is
  'Default billable state for tasks provisioned from this template. '
  'Delivery-group templates are typically true; Overhead/Admin/Meetings false.';

alter table public.ongoing_tasks
  add column if not exists billable boolean;

comment on column public.ongoing_tasks.billable is
  'Per-task override of time_categories.billable. NULL inherits from the '
  'category. Use only for genuine exceptions (e.g. a normally-billable '
  'category being used as overhead for a specific member on a specific client).';

-- Backfill: every template in the Delivery group is billable. Others stay false.
update public.time_categories
   set billable = true
 where group_id = (select id from public.task_groups where label_key = 'delivery');

-- Helpful index for the productivity reclassification query later.
create index if not exists ongoing_tasks_billable_resolved_idx
  on public.ongoing_tasks (clickup_task_id)
  where archived_at is null;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__cc-supabase__apply_migration` with name `0050_live_tasks_billable` and the SQL above.

- [ ] **Step 3: Verify columns and backfill**

Run via `mcp__cc-supabase__execute_sql`:

```sql
select g.label_key as group_key, c.label_key as template_key, c.billable
  from public.time_categories c
  join public.task_groups g on g.id = c.group_id
 where c.archived_at is null
 order by g.display_order, c.display_order;
```

Expected: every `delivery` row has `billable=true`; every `administration`, `meetings`, `overhead` row has `billable=false`. Also confirm:

```sql
select column_name, is_nullable, data_type
  from information_schema.columns
 where table_name = 'ongoing_tasks' and column_name = 'billable';
```

Expected: 1 row, `is_nullable='YES'`, `data_type='boolean'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0050_live_tasks_billable.sql
git commit -m "feat(live-tasks): add billable flag to time_categories + ongoing_tasks"
```

---

## Task 2: Push `billable` to ClickUp on provision

**Files:**
- Modify: `supabase/functions/provision-ongoing-tasks/index.ts:260-274`

- [ ] **Step 1: Resolve effective billable before the POST**

Open [supabase/functions/provision-ongoing-tasks/index.ts](supabase/functions/provision-ongoing-tasks/index.ts). The loop body currently builds the task name and POSTs to ClickUp at lines 259–274. Insert immediately before the `fetch` call (after `const name = buildTaskName(...)`):

```typescript
          // Resolve effective billable: ongoing_tasks override (none yet on insert)
          // is null at create time, so the template default rules.
          const billable = !!tmpl.billable;
```

Then change the POST body to include `billable`:

```typescript
              body: JSON.stringify({
                name,
                description: isOverhead
                  ? `Ongoing time bucket for ${member.full_name}. Category: ${tmpl.label}. Rize posts time entries here. Do not close — this task is perpetual.`
                  : `Ongoing time bucket for ${member.full_name} on ${cell.row?.name}. Category: ${tmpl.label}. Rize posts time entries here. Do not close — this task is perpetual.`,
                assignees: member.clickup_user_id ? [member.clickup_user_id] : [],
                status: "in progress",
                billable,
              }),
```

- [ ] **Step 2: Persist resolved billable on the insert**

Change the `supabase.from("ongoing_tasks").insert({...})` block (currently lines 295–302) to record the resolved value, so reporting doesn't have to re-derive it:

```typescript
          const { error: insErr } = await supabase.from("ongoing_tasks").insert({
            team_member_id: member.id,
            time_category_id: tmpl.id,
            client_id: clientForKey,
            client_list_id: clientListId,
            clickup_task_id: cuTask.id,
            task_name: name,
            billable,
          });
```

- [ ] **Step 3: Include `billable` in the template fetch**

Find the `templates` query earlier in the file (search for `from("time_categories")` — the select list). Add `billable` to the selected columns so `tmpl.billable` is populated:

```typescript
.select("id, label, label_key, group_id, is_custom, client_id, billable")
```

- [ ] **Step 4: Deploy and verify with a single-cell provision**

Deploy via `mcp__cc-supabase__deploy_edge_function` (function name `provision-ongoing-tasks`, source from disk).

In the app, open `/scaffold/live-tasks`, pick one **billable** Delivery template × one member × one client cell that doesn't exist yet, click provision. Then check ClickUp: the new task should show **Billable: On**. Then check DB:

```sql
select clickup_task_id, billable from public.ongoing_tasks
 order by provisioned_at desc limit 1;
```

Expected: `billable=true`. Repeat with a non-billable Meetings template cell — expect `billable=false` and the ClickUp task billable toggle off.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/provision-ongoing-tasks/index.ts
git commit -m "feat(live-tasks): provision ClickUp tasks with resolved billable flag"
```

---

## Task 3: Capture per-entry `billable` in sync

**Files:**
- Modify: `supabase/functions/sync-clickup-actuals/index.ts` (the overhead/ongoing branch, ~L207-240)

- [ ] **Step 1: Verify the existing JSON shape**

`ongoing_actuals.time_entries` is already `jsonb`. ClickUp's `/task/{id}/time` response items include `billable` (boolean) per entry. Read the existing fetch+upsert block in the ongoing-tasks branch and confirm `time_entries` is stored as the raw array. If it is, no change is needed here — but add an explicit sanity assertion in code:

```typescript
          // ClickUp returns per-entry billable. We store the raw entries
          // verbatim so downstream (live-invoice rollup) can filter on it
          // without a re-fetch. Defensive: if the API ever omits it,
          // default to the task's resolved billable flag.
          const entries = (cuBody.data ?? []).map((e: any) => ({
            ...e,
            billable: typeof e.billable === "boolean" ? e.billable : !!task.billable,
          }));
```

Replace the previous local `entries` (or equivalent variable) assignment with this. Use the existing variable names — read the file first; do not invent new ones.

- [ ] **Step 2: Deploy and verify entries land with `billable`**

Deploy `sync-clickup-actuals`. Trigger a sync (or wait for the cron). Then:

```sql
select clickup_task_id,
       jsonb_array_length(time_entries) as n_entries,
       (time_entries->0->>'billable') as first_entry_billable
  from public.ongoing_actuals
 order by synced_at desc
 limit 5;
```

Expected: `first_entry_billable` is `'true'` or `'false'` (never null) for any row that has entries.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/sync-clickup-actuals/index.ts
git commit -m "feat(live-tasks): preserve per-entry billable flag on actuals sync"
```

---

## Task 4: Reclassify productivity by `entry.billable`

**Files:**
- Modify: `supabase/functions/get-productivity/index.ts:209-265`

- [ ] **Step 1: Extend the time-entry type**

Find the `timeBody` declaration (around L209). Add `billable` to the inline type:

```typescript
    const timeBody = await timeRes.json() as {
      data: Array<{
        duration: string;
        start: string;
        billable: boolean;
        user: { id: number };
        task?: { id: string };
      }>;
    };
```

- [ ] **Step 2: Switch the classification predicate**

Replace the `target` assignment (currently L256-258) so the split keys off `entry.billable`, with the `ongoing_tasks` membership kept only as a fallback for older entries that may pre-date the billable-aware sync:

```typescript
      const isBillable = typeof entry.billable === "boolean"
        ? entry.billable
        : !(entry.task?.id && ongoingTaskIds.has(entry.task.id));
      const target = isBillable ? timeMap : overheadMap;
```

Leave the rest of the loop and the `ongoingRows` fetch in place — the fallback still uses it.

- [ ] **Step 3: Deploy and verify the split flips correctly**

Deploy `get-productivity`. In the app, open the Productivity page. Pick a member who has both billable client work and overhead in the current week.

Expected: `totalHours` (billable) reflects only entries with `billable=true` in ClickUp; `totalOverheadHours` reflects the rest. To cross-check, run in ClickUp's time-tracking view for that user and same range — the billable filter total should match `totalHours` to within rounding.

If the numbers don't match: read the ClickUp response in the browser network tab, confirm `billable` is present on entries, and check the legacy-fallback branch isn't masking a missing field.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/get-productivity/index.ts
git commit -m "feat(live-tasks): classify productivity entries by entry.billable"
```

---

## Task 5: SQL view — billable actuals by period

**Files:**
- Create: `supabase/migrations/0051_live_actuals_view.sql`

- [ ] **Step 1: Write the view**

```sql
-- supabase/migrations/0051_live_actuals_view.sql
--
-- live_actuals_by_period — one row per (client × member × billable entry)
-- with the entry's start timestamp exploded out of the time_entries JSON
-- so the invoice builder can filter by period without re-fetching.
--
-- Reads from the latest ongoing_actuals snapshot per task so we never
-- double-count entries that appear across multiple snapshots.

create or replace view public.live_actuals_by_period as
with latest as (
  select distinct on (ongoing_task_id)
    ongoing_task_id,
    time_entries,
    synced_at
  from public.ongoing_actuals
  order by ongoing_task_id, synced_at desc
)
select
  ot.client_id,
  ot.team_member_id,
  tm.primary_department_id    as department_id,
  ot.clickup_task_id,
  ot.time_category_id,
  (e->>'id')                  as entry_id,
  to_timestamp((e->>'start')::bigint / 1000) as entry_start,
  ((e->>'duration')::bigint / 3600000.0)     as hours,
  (e->>'billable')::boolean   as billable
from latest l
join public.ongoing_tasks ot on ot.id = l.ongoing_task_id
join public.team_members tm  on tm.id = ot.team_member_id
cross join lateral jsonb_array_elements(coalesce(l.time_entries, '[]'::jsonb)) as e
where ot.archived_at is null
  and ot.client_id is not null
  and (e->>'billable')::boolean = true;

comment on view public.live_actuals_by_period is
  'Exploded billable time entries from the latest ongoing_actuals snapshot '
  'per task. Filter by entry_start range + client_id to build a period invoice.';
```

- [ ] **Step 2: Apply migration and verify**

Apply via `mcp__cc-supabase__apply_migration`. Then:

```sql
select client_id, team_member_id, department_id,
       count(*) as n_entries,
       round(sum(hours)::numeric, 2) as billable_hours
  from public.live_actuals_by_period
 where entry_start >= date_trunc('month', now()) - interval '1 month'
   and entry_start <  date_trunc('month', now())
 group by 1, 2, 3
 order by billable_hours desc
 limit 10;
```

Expected: a non-empty grid of (client, member, department, hours) for last month. Cross-check one row against ClickUp's time-tracking export for that member + that client list.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0051_live_actuals_view.sql
git commit -m "feat(live-tasks): add live_actuals_by_period view for invoice rollup"
```

---

## Task 6: Edge function — `build-live-invoice`

**Files:**
- Create: `supabase/functions/build-live-invoice/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/build-live-invoice/index.ts
//
// Build draft Xero line items for a client's billable live-task hours
// over a period. Reads live_actuals_by_period (which already filters to
// billable=true) and multiplies hours by the assignee's primary
// department rate. Returns line items — does NOT push to Xero. Push is
// owned by push-to-xero; this function is the rollup source.
//
// Request: POST { client_id, period_start, period_end } (ISO dates)
// Response: { client_id, period_start, period_end, lines: [...], total_cents }

import { cors, json, createServiceRoleClient } from "../_shared/index.ts";

type Body = { client_id: string; period_start: string; period_end: string };

Deno.serve(async (req) => {
  const corsRes = cors(req);
  if (corsRes) return corsRes;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { client_id, period_start, period_end } = (await req.json()) as Body;
    if (!client_id || !period_start || !period_end) {
      return json({ error: "client_id, period_start, period_end required" }, 400);
    }

    const supabase = createServiceRoleClient();

    const { data: rows, error: rowsErr } = await supabase
      .from("live_actuals_by_period")
      .select("team_member_id, department_id, hours, entry_start")
      .eq("client_id", client_id)
      .gte("entry_start", period_start)
      .lt("entry_start", period_end);
    if (rowsErr) return json({ error: rowsErr.message }, 500);

    const memberIds = [...new Set((rows ?? []).map((r) => r.team_member_id))];
    const deptIds = [...new Set((rows ?? []).map((r) => r.department_id).filter(Boolean))];

    const [{ data: members }, { data: depts }] = await Promise.all([
      supabase.from("team_members").select("id, full_name, primary_department_id").in("id", memberIds),
      supabase.from("departments").select("id, name, hourly_rate_cents").in("id", deptIds),
    ]);

    const memberById = new Map((members ?? []).map((m) => [m.id, m]));
    const deptById = new Map((depts ?? []).map((d) => [d.id, d]));

    // Group hours by (member, department) so each line is one labelled row.
    const grouped = new Map<string, { member_id: string; department_id: string; hours: number }>();
    for (const r of rows ?? []) {
      if (!r.department_id) continue; // member with no primary department: drop, flag below
      const key = `${r.team_member_id}::${r.department_id}`;
      const existing = grouped.get(key);
      if (existing) existing.hours += Number(r.hours);
      else grouped.set(key, { member_id: r.team_member_id, department_id: r.department_id, hours: Number(r.hours) });
    }

    const lines = [];
    let total_cents = 0;
    for (const g of grouped.values()) {
      const member = memberById.get(g.member_id);
      const dept = deptById.get(g.department_id);
      if (!member || !dept) continue;
      const rate = dept.hourly_rate_cents ?? 0;
      const hours = Math.round(g.hours * 100) / 100;
      const amount_cents = Math.round(hours * rate);
      total_cents += amount_cents;
      lines.push({
        description: `${dept.name} — ${member.full_name}`,
        quantity: hours,
        unit_amount_cents: rate,
        amount_cents,
      });
    }

    const dropped = (rows ?? [])
      .filter((r) => !r.department_id)
      .reduce((s, r) => s + Number(r.hours), 0);

    return json({
      client_id,
      period_start,
      period_end,
      lines,
      total_cents,
      warnings: dropped > 0
        ? [`${dropped.toFixed(2)} billable hours dropped — assignee has no primary_department_id`]
        : [],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 2: Deploy with `verify_jwt=false`**

Per the project's memory note ([project_es256_edge_fn_auth.md](~/.claude/projects/-Users-brendangunn-Github-cc-service-calculator/memory/project_es256_edge_fn_auth.md)), deploy with `verify_jwt: false`:

Use `mcp__cc-supabase__deploy_edge_function` with `name=build-live-invoice`, `verify_jwt=false`.

- [ ] **Step 3: Verify with a real client + last month**

Pick a real client id and curl the function:

```bash
curl -X POST "$VITE_SUPABASE_URL/functions/v1/build-live-invoice" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"<UUID>","period_start":"2026-04-01","period_end":"2026-05-01"}'
```

Expected: JSON with `lines[]`, each line's `amount_cents = round(quantity * unit_amount_cents)`, and `total_cents = sum(lines.amount_cents)`. Cross-check `total_cents / 100` against the SQL view's `sum(hours) * department rate` for the same range — they must match to within R0.01.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/build-live-invoice/index.ts
git commit -m "feat(live-tasks): add build-live-invoice rollup function"
```

---

## Task 7: Scaffold UI — billable badge per template

**Files:**
- Create: `src/components/scaffold/BillableBadge.tsx`
- Modify: `src/pages/OngoingTasksPlanner.tsx`

- [ ] **Step 1: Write the badge component**

```typescript
// src/components/scaffold/BillableBadge.tsx
import { cn } from "@/lib/utils";

export function BillableBadge({ billable, className }: { billable: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        billable
          ? "bg-m-primary-container text-m-on-primary-container"
          : "bg-m-surface-container-high text-m-on-surface-variant",
        className,
      )}
      title={billable ? "Hours on this task are billable" : "Hours on this task are not billable"}
    >
      {billable ? "Billable" : "Non-billable"}
    </span>
  );
}
```

- [ ] **Step 2: Show the badge next to each template label in the planner**

Read [src/pages/OngoingTasksPlanner.tsx](src/pages/OngoingTasksPlanner.tsx) around L222 (the Tasks/Templates axis rendering). Each template row currently renders `tmpl.label`. Add the badge next to it — pattern (adapt to the existing JSX exactly; do not duplicate the surrounding wrapper):

```tsx
import { BillableBadge } from "@/components/scaffold/BillableBadge";
// ...
<span className="flex items-center gap-1.5">
  {tmpl.label}
  <BillableBadge billable={!!tmpl.billable} />
</span>
```

Also ensure the templates fetch (find `from("time_categories")` or the hook `useTaskTemplates`/`useTimeCategories`) selects `billable`. If a hook is involved, add `billable: boolean` to its return type.

- [ ] **Step 3: Verify in the browser**

Run `npm run dev -- --port 5391` and open `http://localhost:5391/scaffold/live-tasks`. Every Delivery-group template should show a green "Billable" badge; Administration/Meetings/Overhead show grey "Non-billable".

- [ ] **Step 4: Commit**

```bash
git add src/components/scaffold/BillableBadge.tsx src/pages/OngoingTasksPlanner.tsx
git commit -m "feat(live-tasks): show billable badge on planner templates"
```

---

## Task 8: Scaffold UI — Invoice preview sub-page

**Files:**
- Create: `src/pages/LiveTasksInvoicePreview.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the preview page**

```typescript
// src/pages/LiveTasksInvoicePreview.tsx
//
// Live-task invoice preview. Operator picks a client + period; we hit
// build-live-invoice and render the resulting Xero-shaped line items.
// No push yet — this is preview only. Push lives behind a separate
// affordance once the rollup is trusted.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Line = { description: string; quantity: number; unit_amount_cents: number; amount_cents: number };
type Preview = { lines: Line[]; total_cents: number; warnings: string[] };

const ZAR = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const fmt = (cents: number) => ZAR.format(cents / 100);

export default function LiveTasksInvoicePreview() {
  const today = new Date();
  const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const [clientId, setClientId] = useState<string>("");
  const [periodStart, setPeriodStart] = useState(firstOfLastMonth.toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(firstOfThisMonth.toISOString().slice(0, 10));

  const { data: clients } = useQuery({
    queryKey: ["clients-for-invoice"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, short_name")
        .is("archived_at", null)
        .order("short_name");
      if (error) throw error;
      return data;
    },
  });

  const preview = useQuery<Preview>({
    queryKey: ["live-invoice-preview", clientId, periodStart, periodEnd],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("build-live-invoice", {
        body: { client_id: clientId, period_start: periodStart, period_end: periodEnd },
      });
      if (error) throw error;
      return data as Preview;
    },
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-headline-medium">Live tasks — invoice preview</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-label-small">Client</label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {(clients ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.short_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-label-small">Period start</label>
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-label-small">Period end (exclusive)</label>
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <Button onClick={() => preview.refetch()} disabled={!clientId}>Refresh</Button>
      </div>

      {preview.isLoading && <p className="text-body-small text-m-on-surface-variant">Computing…</p>}
      {preview.error && <p className="text-body-small text-m-error">{(preview.error as Error).message}</p>}

      {preview.data && (
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container">
          <table className="w-full text-body-small">
            <thead className="text-label-small text-m-on-surface-variant">
              <tr>
                <th className="text-left p-3">Description</th>
                <th className="text-right p-3">Hours</th>
                <th className="text-right p-3">Rate</th>
                <th className="text-right p-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {preview.data.lines.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-m-on-surface-variant">No billable hours in this period.</td></tr>
              )}
              {preview.data.lines.map((l, i) => (
                <tr key={i} className="border-t border-m-outline-variant">
                  <td className="p-3">{l.description}</td>
                  <td className="p-3 text-right">{l.quantity.toFixed(2)}</td>
                  <td className="p-3 text-right">{fmt(l.unit_amount_cents)}</td>
                  <td className="p-3 text-right">{fmt(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-title-small">
              <tr className="border-t border-m-outline-variant">
                <td className="p-3" colSpan={3}>Total</td>
                <td className="p-3 text-right">{fmt(preview.data.total_cents)}</td>
              </tr>
            </tfoot>
          </table>
          {preview.data.warnings.length > 0 && (
            <ul className="p-3 text-body-small text-m-error space-y-1">
              {preview.data.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

Open [src/App.tsx](src/App.tsx). Near the existing scaffold routes (L134-136), add a lazy import and a sibling route:

```typescript
const LiveTasksInvoicePreview = lazy(() => import("./pages/LiveTasksInvoicePreview"));
// ...
<Route path="/scaffold/invoice-preview" element={<LiveTasksInvoicePreview />} />
```

(Path is `/scaffold/invoice-preview` rather than nesting under `/scaffold/live-tasks/` to keep the existing planner route name unchanged.)

- [ ] **Step 3: Add a nav link**

Locate the Scaffold sub-nav:

```bash
grep -rn "scaffold/foundations" src/ --include="*.tsx"
```

The single match is the file owning the Scaffold sub-nav. Open it, find the JSX block rendering the two existing links (`Live tasks` → `/scaffold/live-tasks`, `Foundations` → `/scaffold/foundations`), and add a third using **the exact same wrapper element + className** as its siblings:

```tsx
<NavLink to="/scaffold/invoice-preview" className={/* match siblings */}>Invoice preview</NavLink>
```

Do not introduce a new wrapper or refactor — copy the existing pattern verbatim and change only `to=` and the label.

- [ ] **Step 4: Verify end-to-end**

Restart dev server. Navigate to `/scaffold/invoice-preview`. Pick a client with live-task hours last month. Click Refresh. Expected: line items render, hours match Task 5's SQL spot-check, total in Rand displays via `Intl.NumberFormat('en-ZA')`.

Then pick a client with **no** live-task hours — expect "No billable hours in this period."

- [ ] **Step 5: Commit**

```bash
git add src/pages/LiveTasksInvoicePreview.tsx src/App.tsx src/components/AppShell.tsx
git commit -m "feat(live-tasks): scaffold > invoice preview page"
```

(Replace `src/components/AppShell.tsx` with the actual file you touched for the nav link.)

---

## Task 9: Sanity sweep + close-out commit

- [ ] **Step 1: Re-run the productivity check after a real sync**

Trigger `sync-clickup-actuals` (cron or manual). Open Productivity for the current week. Confirm a member with mixed billable/non-billable hours shows the right split versus their ClickUp time view filtered by Billable=Yes.

- [ ] **Step 2: Re-run the invoice preview for the same member's clients**

For each client that member touched, run the preview. Confirm `sum(hours)` per member in the lines equals the billable-only figure from step 1 for the same date range.

- [ ] **Step 3: Walk the planner once**

Toggle through the planner axes. Every Delivery template carries the badge; provisioning a new cell from a billable template lands in ClickUp with the billable toggle on (re-verify one fresh cell).

- [ ] **Step 4: Final commit if anything was tweaked**

```bash
git status
# If clean, you're done. If not:
git add -p
git commit -m "chore(live-tasks): post-rollout sweep tweaks"
```

---

## Out of scope (do not implement in this plan)

- Pushing the preview to Xero as a draft invoice (separate task; reuse `push-to-xero` patterns).
- Per-client negotiated rate override (department rate is V1; client rate is V2).
- Bulk re-provision to set ClickUp billable on tasks already created without it — covered by a one-off backfill script after this plan ships.
- Editing `ongoing_tasks.billable` from the UI (the override column exists but stays admin-only via SQL for now).
- Capacity/availability planning, Rize integration changes, AI features.
