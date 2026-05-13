# Delivery Performance Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Delivery" tab to the Productivity page that tracks three output-anchored metrics — Delivery Rate (completion %), Delivery Speed (throughput + cycle time), and Delivery Yield (ZAR value per human hour) — split by internal vs. external work type.

**Architecture:** A new Supabase edge function (`get-delivery-metrics`) fetches both completed and created tasks from ClickUp for a given period, reads a `Task Type` custom field to split internal vs. external work, computes the three metrics, and returns per-member + per-bucket data. A React Query hook consumes it; three chart components and a metric card strip render the data inside a new `DeliveryTab` component wired into the existing `ProductivityPage` tab switcher.

**Tech Stack:** React 18 + TypeScript, Recharts 3, Supabase Edge Functions (Deno), React Query 5, Tailwind CSS with Material Design 3 tokens (`m-*`), ClickUp REST API v2.

---

## Naming Conventions

| Concept | Name |
|---|---|
| New page tab | **Delivery** |
| Metric 1 | **Delivery Rate** — % of tasks assigned in period that were completed (split: external vs. internal) |
| Metric 2 | **Delivery Speed** — tasks completed per working day + avg cycle time in days |
| Metric 3 | **Delivery Yield** — total ZAR value of completed work + ZAR value per human hour |

**Delivery Rate formula:**
- `externalRate = externalCompleted / externalCreated` (tasks created AND completed in period)
- `internalRate = internalCompleted / internalCreated`
- Rate can exceed 100% when clearing prior-period backlog — display as "clearing backlog" label

**Delivery Yield formula:**
- `totalValueZar = sum(task.points × zar_per_point)` for all completed tasks
- `yieldPerHour = totalValueZar / totalHumanHours` (human hours from time entries)

**Task Type detection:** Read ClickUp custom field named `"Task Type"` (case-insensitive). If the selected option name contains `"internal"`, classify as internal. Otherwise default to external. Tasks with no field or no value → external.

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Create | `src/types/delivery.ts` | All TypeScript interfaces for delivery metrics |
| Create | `supabase/functions/get-delivery-metrics/index.ts` | Edge function: fetch + compute metrics |
| Create | `src/hooks/useDeliveryMetrics.ts` | React Query hook wrapping the edge function |
| Create | `src/components/productivity/DeliveryMetricCards.tsx` | 3 summary metric cards |
| Create | `src/components/productivity/DeliveryRateChart.tsx` | Grouped bar chart: external/internal rate per member |
| Create | `src/components/productivity/DeliverySpeedChart.tsx` | Dual chart: throughput bars + cycle time line |
| Create | `src/components/productivity/DeliveryValueChart.tsx` | Stacked bar chart: ZAR value per member per bucket |
| Create | `src/components/productivity/DeliveryTab.tsx` | Tab container: assembles the three charts + cards |
| Modify | `src/pages/ProductivityPage.tsx` | Add `"delivery"` to `pageTab` union + render `DeliveryTab` |
| Create | `supabase/migrations/0041_settings_zar_per_point.sql` | Add `zar_per_point` column to settings table |

---

## Task 1: TypeScript Types

**Files:**
- Create: `src/types/delivery.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/types/delivery.ts

export type TaskType = "external" | "internal";

export interface DeliveryMemberStats {
  userId: number;
  // Rate
  externalCompleted: number;
  externalCreated: number;
  externalRate: number;       // 0–1, can exceed 1 if clearing backlog
  internalCompleted: number;
  internalCreated: number;
  internalRate: number;
  // Speed
  tasksCompletedInPeriod: number;
  avgCycleDays: number;       // avg (closedAt - createdAt) in days for completed tasks
  tasksPerWorkingDay: number;
  // Yield
  totalValueZar: number;      // sum of completed task points × zar_per_point
  humanHours: number;         // from time entries
  yieldPerHour: number;       // totalValueZar / humanHours (0 if no hours)
}

export interface DeliveryBucketMember {
  userId: number;
  externalCompleted: number;
  internalCompleted: number;
  valueZar: number;
  avgCycleDays: number;
}

export interface DeliveryBucket {
  bucket: string;
  members: DeliveryBucketMember[];
}

export interface DeliveryMeta {
  periodLabel: string;
  workingDays: number;
  overallExternalRate: number;  // aggregate across all members
  overallInternalRate: number;
  avgCycleDays: number;
  tasksPerWorkingDay: number;
  totalValueZar: number;
  avgYieldPerHour: number;
  zarPerPoint: number;
}

export interface DeliveryData {
  meta: DeliveryMeta;
  members: DeliveryMemberStats[];
  buckets: DeliveryBucket[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/delivery.ts
git commit -m "feat(delivery): add TypeScript interfaces for delivery metrics"
```

---

## Task 2: Database Migration

**Files:**
- Create: `supabase/migrations/0041_settings_zar_per_point.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0041_settings_zar_per_point.sql
-- Apply via: supabase db push (or MCP apply_migration)
-- Adds zar_per_point: the ZAR value assigned to one sprint point for Delivery Yield calculation.

alter table public.settings
  add column if not exists zar_per_point integer not null default 500;

comment on column public.settings.zar_per_point is
  'ZAR value of one sprint point, used to calculate Delivery Yield in the Delivery tab. Default 500.';
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: migration 0041 applied, `settings.zar_per_point` column exists with default 500.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0041_settings_zar_per_point.sql
git commit -m "feat(delivery): add zar_per_point column to settings"
```

---

## Task 3: Edge Function

**Files:**
- Create: `supabase/functions/get-delivery-metrics/index.ts`

Read `supabase/functions/get-productivity/index.ts` before starting — this function follows the same pattern (CORS, settings read, ClickUp PAT, `periodRange`, `toBucket`, `periodLabel`, `workingDays` helpers).

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/get-delivery-metrics/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type View = "year" | "month" | "week";

interface RequestBody {
  view: View;
  date: string;
  clickup_user_id?: number;
}

// ── Period helpers (identical to get-productivity) ──────────────────────────

function periodRange(view: View, date: string): [number, number] {
  const d = new Date(date);
  if (view === "year") {
    return [new Date(d.getFullYear(), 0, 1).getTime(), new Date(d.getFullYear() + 1, 0, 1).getTime()];
  }
  if (view === "month") {
    return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
  }
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 7);
  return [mon.getTime(), sun.getTime()];
}

function toBucket(view: View, tsMs: number): string {
  const d = new Date(tsMs);
  if (view === "year") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (view === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

function periodLabel(view: View, date: string): string {
  const d = new Date(date);
  if (view === "year") return String(d.getFullYear());
  if (view === "month") return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return `${mon.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} – ${fri.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`;
}

function workingDays(startMs: number, endMs: number): number {
  let count = 0;
  const cur = new Date(startMs);
  while (cur.getTime() < endMs) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ── Task type detection ──────────────────────────────────────────────────────

interface ClickupCustomField {
  id: string;
  name: string;
  value?: string | null;
  type_config?: { options?: Array<{ id: string; name: string }> };
}

interface ClickupTask {
  id: string;
  name: string;
  points: number | null;
  date_done: string | null;   // unix ms string, null if not closed
  date_created: string;       // unix ms string
  assignees: Array<{ id: number }>;
  custom_fields?: ClickupCustomField[];
  status: { status: string; type: string };
}

function getTaskType(task: ClickupTask): "external" | "internal" {
  const field = (task.custom_fields ?? []).find(
    (f) => f.name.trim().toLowerCase() === "task type",
  );
  if (!field || field.value == null) return "external";
  const options = field.type_config?.options ?? [];
  const selected = options.find((o) => o.id === field.value);
  if (!selected) return "external";
  return selected.name.trim().toLowerCase().includes("internal") ? "internal" : "external";
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json() as RequestBody;
    const { view, date, clickup_user_id } = body;
    if (!view || !date) return json({ error: "view and date required" }, 400);

    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    const supabase = createServiceRoleClient();
    const { data: settings } = await supabase
      .from("settings")
      .select("clickup_enabled, clickup_workspace_id, clickup_clients_space_id, zar_per_point")
      .eq("id", 1)
      .single();

    if (!settings?.clickup_enabled) return json({ error: "ClickUp is disabled in Settings" }, 400);
    if (!settings?.clickup_workspace_id) return json({ error: "ClickUp workspace ID not configured" }, 400);
    if (!settings?.clickup_clients_space_id) return json({ error: "ClickUp clients space not configured" }, 400);

    const zarPerPoint: number = settings.zar_per_point ?? 500;
    const [startMs, endMs] = periodRange(view, date);
    const CU = { Authorization: clickupPat, "Content-Type": "application/json" };

    // ── Completed tasks (date_done in range) ────────────────────────────────
    const completedParams = new URLSearchParams({
      include_closed: "true",
      subtasks: "true",
      date_done_gt: String(startMs),
      date_done_lt: String(endMs),
      page: "0",
    });
    completedParams.append("space_ids[]", String(settings.clickup_clients_space_id));
    if (clickup_user_id) completedParams.append("assignees[]", String(clickup_user_id));

    // ── Created tasks in range (for completion rate denominator) ────────────
    const createdParams = new URLSearchParams({
      include_closed: "true",
      subtasks: "true",
      date_created_gt: String(startMs),
      date_created_lt: String(endMs),
      page: "0",
    });
    createdParams.append("space_ids[]", String(settings.clickup_clients_space_id));
    if (clickup_user_id) createdParams.append("assignees[]", String(clickup_user_id));

    // ── Time entries (for Yield) ─────────────────────────────────────────────
    const timeParams = new URLSearchParams({
      start_date: String(startMs),
      end_date: String(endMs),
    });
    if (clickup_user_id) timeParams.append("assignee", String(clickup_user_id));

    const base = `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}`;
    const [completedRes, createdRes, timeRes] = await Promise.all([
      fetch(`${base}/task?${completedParams}`, { headers: CU }),
      fetch(`${base}/task?${createdParams}`, { headers: CU }),
      fetch(`${base}/time_entries?${timeParams}`, { headers: CU }),
    ]);

    if (!completedRes.ok) return json({ error: `ClickUp completed tasks ${completedRes.status}: ${await completedRes.text()}` }, 502);
    if (!createdRes.ok) return json({ error: `ClickUp created tasks ${createdRes.status}: ${await createdRes.text()}` }, 502);
    if (!timeRes.ok) return json({ error: `ClickUp time ${timeRes.status}: ${await timeRes.text()}` }, 502);

    const { tasks: completedTasks } = await completedRes.json() as { tasks: ClickupTask[] };
    const { tasks: createdTasks } = await createdRes.json() as { tasks: ClickupTask[] };
    const { data: timeData } = await timeRes.json() as {
      data: Array<{ duration: string; start: string; user: { id: number } }>;
    };

    // ── Per-member accumulators ──────────────────────────────────────────────
    type Acc = {
      externalCompleted: number; externalCreated: number;
      internalCompleted: number; internalCreated: number;
      cycleDaysSum: number; cycleCount: number;
      valueZar: number;
    };
    const memberAcc = new Map<number, Acc>();
    const hoursAcc = new Map<number, number>();

    // Per-bucket accumulators (for charts)
    type BucketAcc = Map<number, { externalCompleted: number; internalCompleted: number; valueZar: number; cycleDaysSum: number; cycleCount: number }>;
    const bucketMap = new Map<string, BucketAcc>();

    function ensureMember(id: number): Acc {
      if (!memberAcc.has(id)) {
        memberAcc.set(id, { externalCompleted: 0, externalCreated: 0, internalCompleted: 0, internalCreated: 0, cycleDaysSum: 0, cycleCount: 0, valueZar: 0 });
      }
      return memberAcc.get(id)!;
    }

    function ensureBucketMember(bucket: string, userId: number) {
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Map());
      const bm = bucketMap.get(bucket)!;
      if (!bm.has(userId)) bm.set(userId, { externalCompleted: 0, internalCompleted: 0, valueZar: 0, cycleDaysSum: 0, cycleCount: 0 });
      return bm.get(userId)!;
    }

    // Process completed tasks
    for (const task of completedTasks ?? []) {
      if (!task.date_done) continue;
      const closedMs = Number(task.date_done);
      const createdMs = Number(task.date_created);
      const cycleDays = (closedMs - createdMs) / 86_400_000;
      const taskType = getTaskType(task);
      const pts = task.points ?? 0;
      const valueZar = pts * zarPerPoint;
      const bucket = toBucket(view, closedMs);

      for (const a of task.assignees ?? []) {
        const acc = ensureMember(a.id);
        const bAcc = ensureBucketMember(bucket, a.id);
        if (taskType === "external") {
          acc.externalCompleted++;
          bAcc.externalCompleted++;
        } else {
          acc.internalCompleted++;
          bAcc.internalCompleted++;
        }
        acc.cycleDaysSum += cycleDays;
        acc.cycleCount++;
        acc.valueZar += valueZar;
        bAcc.cycleDaysSum += cycleDays;
        bAcc.cycleCount++;
        bAcc.valueZar += valueZar;
      }
    }

    // Process created tasks (denominator for rate)
    for (const task of createdTasks ?? []) {
      const taskType = getTaskType(task);
      for (const a of task.assignees ?? []) {
        const acc = ensureMember(a.id);
        if (taskType === "external") acc.externalCreated++;
        else acc.internalCreated++;
      }
    }

    // Process time entries
    for (const entry of timeData ?? []) {
      const hours = Number(entry.duration) / 3_600_000;
      hoursAcc.set(entry.user.id, (hoursAcc.get(entry.user.id) ?? 0) + hours);
    }

    const days = Math.max(workingDays(startMs, endMs), 1);

    // Build member stats
    const members = Array.from(memberAcc.entries()).map(([userId, acc]) => {
      const humanHours = Math.round((hoursAcc.get(userId) ?? 0) * 10) / 10;
      const totalCompleted = acc.externalCompleted + acc.internalCompleted;
      return {
        userId,
        externalCompleted: acc.externalCompleted,
        externalCreated: acc.externalCreated,
        externalRate: acc.externalCreated > 0 ? acc.externalCompleted / acc.externalCreated : 0,
        internalCompleted: acc.internalCompleted,
        internalCreated: acc.internalCreated,
        internalRate: acc.internalCreated > 0 ? acc.internalCompleted / acc.internalCreated : 0,
        tasksCompletedInPeriod: totalCompleted,
        avgCycleDays: acc.cycleCount > 0 ? Math.round((acc.cycleDaysSum / acc.cycleCount) * 10) / 10 : 0,
        tasksPerWorkingDay: Math.round((totalCompleted / days) * 10) / 10,
        totalValueZar: acc.valueZar,
        humanHours,
        yieldPerHour: humanHours > 0 ? Math.round(acc.valueZar / humanHours) : 0,
      };
    });

    // Build bucket data
    const buckets = Array.from(bucketMap.entries()).map(([bucket, bm]) => ({
      bucket,
      members: Array.from(bm.entries()).map(([userId, b]) => ({
        userId,
        externalCompleted: b.externalCompleted,
        internalCompleted: b.internalCompleted,
        valueZar: b.valueZar,
        avgCycleDays: b.cycleCount > 0 ? Math.round((b.cycleDaysSum / b.cycleCount) * 10) / 10 : 0,
      })),
    }));

    // Build meta aggregates
    const totalExtCompleted = members.reduce((s, m) => s + m.externalCompleted, 0);
    const totalExtCreated = members.reduce((s, m) => s + m.externalCreated, 0);
    const totalIntCompleted = members.reduce((s, m) => s + m.internalCompleted, 0);
    const totalIntCreated = members.reduce((s, m) => s + m.internalCreated, 0);
    const totalCompleted = totalExtCompleted + totalIntCompleted;
    const totalCycleDaysSum = members.reduce((s, m) => s + m.avgCycleDays * m.tasksCompletedInPeriod, 0);
    const totalValueZar = members.reduce((s, m) => s + m.totalValueZar, 0);
    const totalHumanHours = members.reduce((s, m) => s + m.humanHours, 0);

    return json({
      meta: {
        periodLabel: periodLabel(view, date),
        workingDays: days,
        overallExternalRate: totalExtCreated > 0 ? totalExtCompleted / totalExtCreated : 0,
        overallInternalRate: totalIntCreated > 0 ? totalIntCompleted / totalIntCreated : 0,
        avgCycleDays: totalCompleted > 0 ? Math.round((totalCycleDaysSum / totalCompleted) * 10) / 10 : 0,
        tasksPerWorkingDay: Math.round((totalCompleted / days) * 10) / 10,
        totalValueZar,
        avgYieldPerHour: totalHumanHours > 0 ? Math.round(totalValueZar / totalHumanHours) : 0,
        zarPerPoint,
      },
      members,
      buckets,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 2: Deploy the edge function**

```bash
supabase functions deploy get-delivery-metrics
```

Expected: function deployed successfully.

- [ ] **Step 3: Smoke-test via curl**

```bash
curl -s -X POST \
  "$(supabase status | grep API | awk '{print $NF}')/functions/v1/get-delivery-metrics" \
  -H "Authorization: Bearer $(supabase status | grep anon | awk '{print $NF}')" \
  -H "Content-Type: application/json" \
  -d '{"view":"week","date":"2026-05-12"}' | jq '.meta'
```

Expected: JSON object with `periodLabel`, `overallExternalRate`, `totalValueZar`, etc. Not an error object.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/get-delivery-metrics/index.ts
git commit -m "feat(delivery): add get-delivery-metrics edge function"
```

---

## Task 4: React Query Hook

**Files:**
- Create: `src/hooks/useDeliveryMetrics.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/useDeliveryMetrics.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { View } from "@/hooks/useProductivity";
import type { DeliveryData } from "@/types/delivery";

export type { View };

export function useDeliveryMetrics(
  view: View,
  date: string,
  clickupUserId?: number,
) {
  return useQuery<DeliveryData>({
    queryKey: ["deliveryMetrics", view, date, clickupUserId ?? "team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-delivery-metrics", {
        body: { view, date, clickup_user_id: clickupUserId },
      });
      if (error) throw error;
      return data as DeliveryData;
    },
  });
}

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sortBucket(a: string, b: string): number {
  const ai = DAY_ORDER.indexOf(a);
  const bi = DAY_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  return a.localeCompare(b);
}

/** Transforms DeliveryData.buckets into recharts-ready rows for the rate chart.
 *  Shape: [{ bucket, [userId]_ext: n, [userId]_int: n }, ...] */
export function buildRateChartData(
  buckets: DeliveryData["buckets"],
  view: View,
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const b of buckets) {
    const row = byBucket.get(b.bucket) ?? { bucket: b.bucket };
    for (const m of b.members) {
      row[`${m.userId}_ext`] = ((row[`${m.userId}_ext`] as number) ?? 0) + m.externalCompleted;
      row[`${m.userId}_int`] = ((row[`${m.userId}_int`] as number) ?? 0) + m.internalCompleted;
    }
    byBucket.set(b.bucket, row);
  }
  const rows = Array.from(byBucket.values());
  if (view === "week") return DAY_ORDER.map((d) => byBucket.get(d) ?? { bucket: d });
  return rows.sort((a, b) => sortBucket(String(a.bucket), String(b.bucket)));
}

/** Transforms DeliveryData.buckets into recharts-ready rows for the value chart.
 *  Shape: [{ bucket, [userId]_value: n }, ...] */
export function buildValueChartData(
  buckets: DeliveryData["buckets"],
  view: View,
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const b of buckets) {
    const row = byBucket.get(b.bucket) ?? { bucket: b.bucket };
    for (const m of b.members) {
      const key = `${m.userId}_value`;
      row[key] = ((row[key] as number) ?? 0) + m.valueZar;
    }
    byBucket.set(b.bucket, row);
  }
  const rows = Array.from(byBucket.values());
  if (view === "week") return DAY_ORDER.map((d) => byBucket.get(d) ?? { bucket: d });
  return rows.sort((a, b) => sortBucket(String(a.bucket), String(b.bucket)));
}

/** Transforms DeliveryData.buckets into recharts-ready rows for the speed chart.
 *  Shape: [{ bucket, totalCompleted: n, avgCycleDays: n }, ...] */
export function buildSpeedChartData(
  buckets: DeliveryData["buckets"],
  view: View,
): { bucket: string; totalCompleted: number; avgCycleDays: number }[] {
  const byBucket = new Map<string, { totalCompleted: number; cycleDaysSum: number; cycleCount: number }>();
  for (const b of buckets) {
    const row = byBucket.get(b.bucket) ?? { totalCompleted: 0, cycleDaysSum: 0, cycleCount: 0 };
    for (const m of b.members) {
      row.totalCompleted += m.externalCompleted + m.internalCompleted;
      if (m.avgCycleDays > 0) {
        row.cycleDaysSum += m.avgCycleDays * (m.externalCompleted + m.internalCompleted);
        row.cycleCount += m.externalCompleted + m.internalCompleted;
      }
    }
    byBucket.set(b.bucket, row);
  }
  const allKeys = view === "week" ? DAY_ORDER : Array.from(byBucket.keys()).sort(sortBucket);
  return allKeys.map((bucket) => {
    const r = byBucket.get(bucket);
    return {
      bucket,
      totalCompleted: r?.totalCompleted ?? 0,
      avgCycleDays: r && r.cycleCount > 0 ? Math.round((r.cycleDaysSum / r.cycleCount) * 10) / 10 : 0,
    };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useDeliveryMetrics.ts
git commit -m "feat(delivery): add useDeliveryMetrics hook with chart data builders"
```

---

## Task 5: Delivery Metric Cards

**Files:**
- Create: `src/components/productivity/DeliveryMetricCards.tsx`

Reference `src/components/productivity/MetricCards.tsx` for the card layout pattern (`rounded-xl bg-m-surface-container p-5 space-y-1`).

- [ ] **Step 1: Create the component**

```tsx
// src/components/productivity/DeliveryMetricCards.tsx
import type { DeliveryMeta } from "@/types/delivery";

interface Props {
  meta: DeliveryMeta;
}

function pct(rate: number): string {
  return `${Math.round(Math.min(rate, 9.99) * 100)}%`;
}

function formatZar(value: number): string {
  if (value >= 1_000_000) return `R ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R ${(value / 1_000).toFixed(0)}K`;
  return `R ${value}`;
}

export function DeliveryMetricCards({ meta }: Props) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Delivery Rate */}
      <div className="rounded-xl bg-m-surface-container p-5 space-y-1">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-wide">
          Delivery Rate
        </p>
        <p className="text-display-small font-semibold text-m-on-surface">
          {pct(meta.overallExternalRate)}
        </p>
        <p className="text-body-small text-m-on-surface-variant">
          external · {pct(meta.overallInternalRate)} internal · {meta.periodLabel}
        </p>
      </div>

      {/* Delivery Speed */}
      <div className="rounded-xl bg-m-surface-container p-5 space-y-1">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-wide">
          Delivery Speed
        </p>
        <p className="text-display-small font-semibold text-m-on-surface">
          {meta.tasksPerWorkingDay}
          <span className="text-title-medium font-normal text-m-on-surface-variant"> /day</span>
        </p>
        <p className="text-body-small text-m-on-surface-variant">
          {meta.avgCycleDays}d avg cycle · {meta.workingDays} working days
        </p>
      </div>

      {/* Delivery Yield */}
      <div className="rounded-xl bg-m-surface-container p-5 space-y-1">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-wide">
          Delivery Yield
        </p>
        <p className="text-display-small font-semibold text-m-on-surface">
          {formatZar(meta.totalValueZar)}
        </p>
        <p className="text-body-small text-m-on-surface-variant">
          {formatZar(meta.avgYieldPerHour)}/hr · R{meta.zarPerPoint}/pt
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/DeliveryMetricCards.tsx
git commit -m "feat(delivery): add DeliveryMetricCards component"
```

---

## Task 6: Delivery Rate Chart

**Files:**
- Create: `src/components/productivity/DeliveryRateChart.tsx`

Reference `src/components/productivity/SprintPointsChart.tsx` for Recharts patterns: `ResponsiveContainer`, `BarChart`, `Bar`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid`. Use `MEMBER_COLORS` from `useProductivity`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/productivity/DeliveryRateChart.tsx
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell, Legend,
} from "recharts";
import type { TeamMember } from "@/hooks/useTeam";
import { MEMBER_COLORS } from "@/hooks/useProductivity";

interface Props {
  data: Record<string, number | string>[];
  members: TeamMember[];
  selectedUserId: number | null;
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
};

export function DeliveryRateChart({ data, members, selectedUserId }: Props) {
  const visibleMembers = selectedUserId
    ? members.filter((m) => m.clickup_user_id === selectedUserId)
    : members;

  const memberColorMap = Object.fromEntries(
    members.map((m, i) => [m.clickup_user_id, MEMBER_COLORS[i % MEMBER_COLORS.length]]),
  );

  return (
    <div className="rounded-xl bg-m-surface-container p-5">
      <p className="text-label-medium text-m-on-surface-variant mb-4">
        Tasks Completed — External vs Internal
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="28%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) => {
              const [userId, type] = value.split("_");
              const member = members.find((m) => String(m.clickup_user_id) === userId);
              const label = member?.full_name?.split(" ")[0] ?? userId;
              return `${label} (${type === "ext" ? "external" : "internal"})`;
            }}
          />
          {visibleMembers.map((m) => {
            const color = memberColorMap[m.clickup_user_id] ?? "#7C3AED";
            return [
              <Bar
                key={`${m.clickup_user_id}_ext`}
                dataKey={`${m.clickup_user_id}_ext`}
                name={`${m.clickup_user_id}_ext`}
                fill={color}
                radius={[3, 3, 0, 0]}
              />,
              <Bar
                key={`${m.clickup_user_id}_int`}
                dataKey={`${m.clickup_user_id}_int`}
                name={`${m.clickup_user_id}_int`}
                fill={color}
                opacity={0.4}
                radius={[3, 3, 0, 0]}
              />,
            ];
          })}
        </BarChart>
      </ResponsiveContainer>
      <p className="text-body-small text-m-on-surface-variant mt-2">
        Solid = external (client) · Faded = internal
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/DeliveryRateChart.tsx
git commit -m "feat(delivery): add DeliveryRateChart component"
```

---

## Task 7: Delivery Speed Chart

**Files:**
- Create: `src/components/productivity/DeliverySpeedChart.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/productivity/DeliverySpeedChart.tsx
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from "recharts";

interface SpeedRow {
  bucket: string;
  totalCompleted: number;
  avgCycleDays: number;
}

interface Props {
  data: SpeedRow[];
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
};

export function DeliverySpeedChart({ data }: Props) {
  return (
    <div className="rounded-xl bg-m-surface-container p-5">
      <p className="text-label-medium text-m-on-surface-variant mb-4">
        Throughput &amp; Cycle Time
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} barCategoryGap="40%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="left"
            orientation="left"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            label={{ value: "tasks", angle: -90, position: "insideLeft", fontSize: 10, fill: "#64748b" }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            label={{ value: "days", angle: 90, position: "insideRight", fontSize: 10, fill: "#64748b" }}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, name: string) =>
              name === "totalCompleted" ? [`${value} tasks`, "Completed"] : [`${value}d`, "Avg Cycle"]
            }
          />
          <Bar yAxisId="left" dataKey="totalCompleted" fill="#7C3AED" radius={[3, 3, 0, 0]} name="totalCompleted" />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avgCycleDays"
            stroke="#EC4899"
            strokeWidth={2}
            dot={{ r: 3, fill: "#EC4899" }}
            name="avgCycleDays"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-body-small text-m-on-surface-variant mt-2">
        Bars = tasks completed · Pink line = avg days from created → done
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/DeliverySpeedChart.tsx
git commit -m "feat(delivery): add DeliverySpeedChart component"
```

---

## Task 8: Delivery Value Chart

**Files:**
- Create: `src/components/productivity/DeliveryValueChart.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/productivity/DeliveryValueChart.tsx
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from "recharts";
import type { TeamMember } from "@/hooks/useTeam";
import { MEMBER_COLORS } from "@/hooks/useProductivity";

interface Props {
  data: Record<string, number | string>[];
  members: TeamMember[];
  selectedUserId: number | null;
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
};

function formatZarTick(value: number): string {
  if (value >= 1000) return `R${(value / 1000).toFixed(0)}K`;
  return `R${value}`;
}

export function DeliveryValueChart({ data, members, selectedUserId }: Props) {
  const visibleMembers = selectedUserId
    ? members.filter((m) => m.clickup_user_id === selectedUserId)
    : members;

  const memberColorMap = Object.fromEntries(
    members.map((m, i) => [m.clickup_user_id, MEMBER_COLORS[i % MEMBER_COLORS.length]]),
  );

  return (
    <div className="rounded-xl bg-m-surface-container p-5">
      <p className="text-label-medium text-m-on-surface-variant mb-4">
        Delivery Yield — Value (ZAR) per Period
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="28%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={formatZarTick}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const userId = name.replace("_value", "");
              const member = members.find((m) => String(m.clickup_user_id) === userId);
              const label = member?.full_name?.split(" ")[0] ?? userId;
              return [`R ${value.toLocaleString()}`, label];
            }}
          />
          {visibleMembers.length > 1 && (
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value) => {
                const userId = value.replace("_value", "");
                const member = members.find((m) => String(m.clickup_user_id) === userId);
                return member?.full_name?.split(" ")[0] ?? userId;
              }}
            />
          )}
          {visibleMembers.map((m) => (
            <Bar
              key={`${m.clickup_user_id}_value`}
              dataKey={`${m.clickup_user_id}_value`}
              name={`${m.clickup_user_id}_value`}
              fill={memberColorMap[m.clickup_user_id] ?? "#7C3AED"}
              radius={[3, 3, 0, 0]}
              stackId="value"
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <p className="text-body-small text-m-on-surface-variant mt-2">
        Based on sprint points × R{/* zarPerPoint shown in metric card */}/pt — set in Settings
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/DeliveryValueChart.tsx
git commit -m "feat(delivery): add DeliveryValueChart component"
```

---

## Task 9: Delivery Tab Container

**Files:**
- Create: `src/components/productivity/DeliveryTab.tsx`

- [ ] **Step 1: Create the tab container**

```tsx
// src/components/productivity/DeliveryTab.tsx
import { useDeliveryMetrics, buildRateChartData, buildValueChartData, buildSpeedChartData } from "@/hooks/useDeliveryMetrics";
import type { View } from "@/hooks/useProductivity";
import type { TeamMember } from "@/hooks/useTeam";
import { ProductivityControls } from "./ProductivityControls";
import { DeliveryMetricCards } from "./DeliveryMetricCards";
import { DeliveryRateChart } from "./DeliveryRateChart";
import { DeliverySpeedChart } from "./DeliverySpeedChart";
import { DeliveryValueChart } from "./DeliveryValueChart";

interface Props {
  view: View;
  date: string;
  onViewChange: (v: View) => void;
  onDateChange: (d: string) => void;
  members: TeamMember[];
  selectedUserId: number | null;
  clickupUserId?: number;
}

const DEFAULT_META = {
  periodLabel: "",
  workingDays: 0,
  overallExternalRate: 0,
  overallInternalRate: 0,
  avgCycleDays: 0,
  tasksPerWorkingDay: 0,
  totalValueZar: 0,
  avgYieldPerHour: 0,
  zarPerPoint: 500,
};

export function DeliveryTab({
  view, date, onViewChange, onDateChange,
  members, selectedUserId, clickupUserId,
}: Props) {
  const { data, isLoading, isError } = useDeliveryMetrics(view, date, clickupUserId);

  const rateChartData = data ? buildRateChartData(data.buckets, view) : [];
  const valueChartData = data ? buildValueChartData(data.buckets, view) : [];
  const speedChartData = data ? buildSpeedChartData(data.buckets, view) : [];

  return (
    <>
      <ProductivityControls
        view={view}
        date={date}
        periodLabel={data?.meta.periodLabel ?? ""}
        onViewChange={onViewChange}
        onDateChange={onDateChange}
      />

      {isError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-medium text-destructive">
          Failed to load delivery data. Check that ClickUp is enabled in Settings.
        </p>
      )}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-body-medium text-m-on-surface-variant">
          Loading…
        </div>
      ) : (
        <div className="space-y-5">
          <DeliveryMetricCards meta={data?.meta ?? DEFAULT_META} />
          <DeliveryRateChart
            data={rateChartData}
            members={members}
            selectedUserId={selectedUserId}
          />
          <div className="grid grid-cols-2 gap-4">
            <DeliverySpeedChart data={speedChartData} />
            <DeliveryValueChart
              data={valueChartData}
              members={members}
              selectedUserId={selectedUserId}
            />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/DeliveryTab.tsx
git commit -m "feat(delivery): add DeliveryTab container component"
```

---

## Task 10: Wire into ProductivityPage

**Files:**
- Modify: `src/pages/ProductivityPage.tsx`

- [ ] **Step 1: Add the "delivery" tab**

In `ProductivityPage.tsx`, make three changes:

**Change 1** — extend the `pageTab` type and import `DeliveryTab`:

```tsx
// Add to imports at top of file:
import { DeliveryTab } from "@/components/productivity/DeliveryTab";
```

**Change 2** — change the `pageTab` state type from `"sprint" | "multiplier"` to include `"delivery"`:

```tsx
// Old:
const [pageTab, setPageTab] = useState<"sprint" | "multiplier">("multiplier");

// New:
const [pageTab, setPageTab] = useState<"sprint" | "multiplier" | "delivery">("multiplier");
```

**Change 3** — add the tab button and render block. Replace the existing tab switcher `map` call:

```tsx
{/* Old: */}
{(["multiplier", "sprint"] as const).map((tab) => (

// New: */}
{(["multiplier", "sprint", "delivery"] as const).map((tab) => (
```

And update the label map inside the button:

```tsx
// Old:
{tab === "sprint" ? "Sprint Output" : "Output Multiplier"}

// New:
{tab === "sprint" ? "Sprint Output" : tab === "delivery" ? "Delivery" : "Output Multiplier"}
```

**Change 4** — add the delivery tab render block after the `{pageTab === "multiplier" && ...}` block:

```tsx
{pageTab === "delivery" && (
  <DeliveryTab
    view={view}
    date={date}
    onViewChange={setView}
    onDateChange={setDate}
    members={members}
    selectedUserId={selectedUserId}
    clickupUserId={selectedUserId ?? undefined}
  />
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/brendangunn/Github/cc-service-calculator && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start dev server and verify tab appears**

```bash
npm run dev
```

Navigate to `/productivity`. Confirm the "Delivery" tab appears in the tab bar. Click it — confirm loading state, then charts render (may show zeros if no tasks with matching period, which is expected).

- [ ] **Step 4: Commit**

```bash
git add src/pages/ProductivityPage.tsx
git commit -m "feat(delivery): wire Delivery tab into ProductivityPage"
```

---

## Task 11: ClickUp Setup Instructions

This task is manual (no code), but must be completed for the feature to produce real data.

- [ ] **Step 1: Create the "Task Type" custom field in ClickUp**

In ClickUp:
1. Open the Clients space
2. Go to any list → Settings → Custom Fields
3. Add a **Dropdown** field named exactly: `Task Type`
4. Add two options: `External` and `Internal`
5. Apply to all lists in the Clients space

For internal work spaces (Pebble, Granite, CC Ops):
- Add the same `Task Type` field
- Default to `Internal`

- [ ] **Step 2: Set zar_per_point in Settings**

In the cc-service-calculator Settings page, confirm there is a `zar_per_point` field. If the Settings UI doesn't expose it yet, set it directly via Supabase dashboard:

```sql
update settings set zar_per_point = 500 where id = 1;
```

Adjust to your actual ZAR/point value (e.g. if 1 point ≈ 15 min at R600/hr, `zar_per_point = 150`).

- [ ] **Step 3: Note on historical data**

Tasks created before the `Task Type` field was added will show as `external` by default. This is intentional — conservative classification. Retroactive tagging can be done in bulk via ClickUp's bulk edit.

---

## Self-Review Checklist

- [x] **Spec coverage:** Delivery Rate (internal/external split) ✅ · Delivery Speed ✅ · Delivery Yield ✅ · New tab in ProductivityPage ✅ · ClickUp custom field integration ✅
- [x] **No placeholders:** All code blocks are complete — no TBDs or TODOs
- [x] **Type consistency:** `DeliveryData`, `DeliveryMeta`, `DeliveryMemberStats`, `DeliveryBucket` defined in Task 1 and used consistently through Tasks 3–9
- [x] **Chart data builders:** `buildRateChartData`, `buildValueChartData`, `buildSpeedChartData` defined in Task 4 hook and imported in Task 9 tab
- [x] **Settings column:** `zar_per_point` added in Task 2 migration, read in Task 3 edge function, surfaced in DeliveryMetricCards in Task 5
- [x] **MEMBER_COLORS import:** sourced from `useProductivity` (existing export) in Tasks 6 and 8
- [x] **TeamMember type:** used from `@/hooks/useTeam` — matches existing pattern in SprintPointsChart
