# Productivity Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/productivity` page that shows team sprint points and time tracked by period, pulled live from ClickUp, with a left-sidebar team member filter and Year/Month/Week views.

**Architecture:** A single `get-productivity` edge function calls ClickUp's tasks and time entries APIs in parallel and returns bucketed data. The frontend has one `useProductivity` hook feeding two Recharts bar charts. Team member filtering happens by passing the member's `clickup_user_id` to the edge function.

**Tech Stack:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Recharts + TanStack Query + Supabase Edge Functions (Deno) + ClickUp API v2

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/0037_productivity_goal.sql` | Add `productivity_goal_points` column to settings |
| Modify | `src/types/db.ts` | Regenerated — add `productivity_goal_points` to Settings row |
| Modify | `src/pages/Settings.tsx` | Add "Productivity" nav section + goal input |
| Create | `supabase/functions/get-productivity/index.ts` | Edge function — parallel ClickUp tasks + time entries |
| Create | `src/hooks/useProductivity.ts` | TanStack Query hook for get-productivity |
| Create | `src/hooks/useProductivity.test.ts` | Unit tests for hook utilities |
| Create | `src/components/productivity/TeamSidebar.tsx` | Left panel — member list + selection state |
| Create | `src/components/productivity/ProductivityControls.tsx` | View tabs + date navigator (prev/next + label) |
| Create | `src/components/productivity/MetricCards.tsx` | 4-up summary row |
| Create | `src/components/productivity/SprintPointsChart.tsx` | Stacked bar chart + goal line |
| Create | `src/components/productivity/HoursTrackedChart.tsx` | Hours bar chart |
| Create | `src/pages/ProductivityPage.tsx` | Page shell — composes all components |
| Modify | `src/App.tsx` | Add `/productivity` lazy route |
| Modify | `src/components/nav/navItems.ts` | Add Productivity nav item |

---

## Task 1: DB migration — add productivity_goal_points

**Files:**
- Create: `supabase/migrations/0037_productivity_goal.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0037_productivity_goal.sql
alter table settings
  add column if not exists productivity_goal_points integer not null default 40;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push --project-ref lpgwxacoqiqpcfpkklib
```

Expected: `Applied 1 migration` (or similar success message)

- [ ] **Step 3: Regenerate TypeScript types**

Use the `mcp__cc-supabase__generate_typescript_types` tool with project ref `lpgwxacoqiqpcfpkklib`. Copy the output into `src/types/db.ts`, replacing the existing file contents.

Verify `productivity_goal_points: number` appears in the `settings` Row type.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0037_productivity_goal.sql src/types/db.ts
git commit -m "feat(productivity): add productivity_goal_points to settings"
```

---

## Task 2: Settings page — Productivity section

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add "Productivity" to the NAV array**

In `src/pages/Settings.tsx`, find the `NAV` array and add a new entry:

```ts
type SectionKey = "clickup" | "anthropic" | "xero" | "gmail" | "sow" | "productivity";

const NAV: { key: SectionKey; label: string }[] = [
  { key: "clickup",      label: "ClickUp" },
  { key: "anthropic",    label: "Anthropic" },
  { key: "xero",         label: "Xero" },
  { key: "gmail",        label: "Gmail" },
  { key: "sow",          label: "SOW Clauses" },
  { key: "productivity", label: "Productivity" },
];
```

- [ ] **Step 2: Add local state for the goal input**

Add to the existing state declarations inside the `Settings` component:

```ts
const [goalInput, setGoalInput] = useState(
  String(s.productivity_goal_points ?? 40)
);
```

- [ ] **Step 3: Add the Productivity section JSX**

After the `{activeSection === "sow" && ...}` block, add:

```tsx
{activeSection === "productivity" && (
  <Card>
    <CardHeader>
      <CardTitle>Productivity</CardTitle>
      <CardDescription>
        Team-wide sprint point targets shown on the Productivity page.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="prod-goal">Daily sprint point goal (team total)</Label>
        <Input
          id="prod-goal"
          type="number"
          min={1}
          max={999}
          value={goalInput}
          onChange={(e) => setGoalInput(e.target.value)}
        />
        <p className="text-label-small text-m-on-surface-variant">
          A dashed goal line appears on the sprint points chart at this value.
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => {
          const parsed = parseInt(goalInput, 10);
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 999) {
            toast.error("Goal must be between 1 and 999");
            return;
          }
          update.mutate(
            { productivity_goal_points: parsed },
            { onSuccess: () => toast.success("Saved") },
          );
        }}
      >
        Save goal
      </Button>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 4: Start the dev server and verify**

```bash
npm run dev
```

Navigate to `/settings`, click "Productivity" in the left nav. Confirm the input renders with value "40". Change to "50", click "Save goal", confirm toast "Saved" appears.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(productivity): add goal setting to Settings page"
```

---

## Task 3: Edge function — get-productivity

**Files:**
- Create: `supabase/functions/get-productivity/index.ts`

- [ ] **Step 1: Write the edge function**

```ts
// supabase/functions/get-productivity/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type View = "year" | "month" | "week";

interface RequestBody {
  view: View;
  date: string; // ISO date string, e.g. "2026-05-12"
  clickup_user_id?: number;
}

interface SprintPoint {
  bucket: string;
  userId: number;
  points: number;
}

interface TimeEntry {
  bucket: string;
  userId: number;
  hours: number;
}

interface ResponseBody {
  sprintPoints: SprintPoint[];
  timeEntries: TimeEntry[];
  meta: {
    periodLabel: string;
    totalPoints: number;
    totalHours: number;
    dailyAvg: number;
    activeContributors: number;
  };
}

/** Returns [startMs, endMs] for the period containing `date` based on `view` */
function periodRange(view: View, date: string): [number, number] {
  const d = new Date(date);
  if (view === "year") {
    const start = new Date(d.getFullYear(), 0, 1);
    const end = new Date(d.getFullYear() + 1, 0, 1);
    return [start.getTime(), end.getTime()];
  }
  if (view === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return [start.getTime(), end.getTime()];
  }
  // week: Mon–Sun of the ISO week containing date
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 7);
  return [mon.getTime(), sun.getTime()];
}

/** Returns the bucket string for a given timestamp and view */
function toBucket(view: View, tsMs: number): string {
  const d = new Date(tsMs);
  if (view === "year") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (view === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // week: return Mon/Tue/Wed/Thu/Fri/Sat/Sun
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

/** Returns a human-readable period label */
function periodLabel(view: View, date: string): string {
  const d = new Date(date);
  if (view === "year") return String(d.getFullYear());
  if (view === "month") {
    return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  }
  // week: find Monday
  const day = d.getDay();
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return `${mon.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} – ${fri.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Count working days (Mon–Fri) in the period */
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
      .select("clickup_enabled, clickup_workspace_id, clickup_clients_space_id")
      .eq("id", 1)
      .single();

    if (!settings?.clickup_enabled) return json({ error: "ClickUp is disabled in Settings" }, 400);
    if (!settings?.clickup_workspace_id) return json({ error: "ClickUp workspace ID not configured" }, 400);
    if (!settings?.clickup_clients_space_id) return json({ error: "ClickUp clients space not configured" }, 400);

    const [startMs, endMs] = periodRange(view, date);
    const CU_HEADERS = { Authorization: clickupPat, "Content-Type": "application/json" };

    // Build task query params
    const taskParams = new URLSearchParams({
      include_closed: "true",
      subtasks: "true",
      date_done_gt: String(startMs),
      date_done_lt: String(endMs),
      page: "0",
    });
    if (clickup_user_id) taskParams.append("assignees[]", String(clickup_user_id));

    // Build time entries query params
    const timeParams = new URLSearchParams({
      start_date: String(startMs),
      end_date: String(endMs),
    });
    if (clickup_user_id) timeParams.append("assignee", String(clickup_user_id));

    // Parallel fetch
    const [tasksRes, timeRes] = await Promise.all([
      fetch(
        `https://api.clickup.com/api/v2/space/${settings.clickup_clients_space_id}/task?${taskParams}`,
        { headers: CU_HEADERS },
      ),
      fetch(
        `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/time_entries?${timeParams}`,
        { headers: CU_HEADERS },
      ),
    ]);

    if (!tasksRes.ok) return json({ error: `ClickUp tasks ${tasksRes.status}: ${await tasksRes.text()}` }, 502);
    if (!timeRes.ok) return json({ error: `ClickUp time ${timeRes.status}: ${await timeRes.text()}` }, 502);

    const tasksBody = await tasksRes.json() as {
      tasks: Array<{
        points: number | null;
        date_done: string; // unix ms as string
        assignees: Array<{ id: number }>;
      }>;
    };
    const timeBody = await timeRes.json() as {
      data: Array<{
        duration: string; // ms as string
        start: string;    // unix ms as string
        user: { id: number };
      }>;
    };

    // Aggregate sprint points by bucket + userId
    const sprintMap = new Map<string, SprintPoint>();
    for (const task of tasksBody.tasks ?? []) {
      const pts = task.points ?? 0;
      if (pts === 0) continue;
      const bucket = toBucket(view, Number(task.date_done));
      for (const assignee of task.assignees ?? []) {
        const key = `${bucket}::${assignee.id}`;
        const existing = sprintMap.get(key);
        if (existing) {
          existing.points += pts;
        } else {
          sprintMap.set(key, { bucket, userId: assignee.id, points: pts });
        }
      }
    }

    // Aggregate time entries by bucket + userId
    const timeMap = new Map<string, TimeEntry>();
    for (const entry of timeBody.data ?? []) {
      const hours = Number(entry.duration) / 3_600_000;
      const bucket = toBucket(view, Number(entry.start));
      const key = `${bucket}::${entry.user.id}`;
      const existing = timeMap.get(key);
      if (existing) {
        existing.hours += hours;
      } else {
        timeMap.set(key, { bucket, userId: entry.user.id, hours });
      }
    }

    const sprintPoints = Array.from(sprintMap.values());
    const timeEntries = Array.from(timeMap.values());

    const totalPoints = sprintPoints.reduce((s, r) => s + r.points, 0);
    const totalHours = timeEntries.reduce((s, r) => s + r.hours, 0);
    const days = Math.max(workingDays(startMs, endMs), 1);
    const activeContributors = new Set([
      ...sprintPoints.map((r) => r.userId),
      ...timeEntries.map((r) => r.userId),
    ]).size;

    const result: ResponseBody = {
      sprintPoints,
      timeEntries,
      meta: {
        periodLabel: periodLabel(view, date),
        totalPoints,
        totalHours: Math.round(totalHours * 10) / 10,
        dailyAvg: Math.round((totalPoints / days) * 10) / 10,
        activeContributors,
      },
    };

    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 2: Deploy the edge function**

```bash
npx supabase functions deploy get-productivity --project-ref lpgwxacoqiqpcfpkklib --no-verify-jwt
```

Expected: `Deployed get-productivity`

- [ ] **Step 3: Smoke-test via curl**

```bash
curl -X POST \
  "$(npx supabase functions url get-productivity --project-ref lpgwxacoqiqpcfpkklib)" \
  -H "Content-Type: application/json" \
  -d '{"view":"month","date":"2026-05-12"}'
```

Expected: JSON with `sprintPoints`, `timeEntries`, and `meta` keys. Arrays may be empty if no tasks were completed this month — that's fine. An error about "ClickUp disabled" means settings need configuring first.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/get-productivity/
git commit -m "feat(productivity): add get-productivity edge function"
```

---

## Task 4: Frontend hook — useProductivity

**Files:**
- Create: `src/hooks/useProductivity.ts`
- Create: `src/hooks/useProductivity.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/hooks/useProductivity.test.ts
import { describe, it, expect } from "vitest";
import { buildChartData, MEMBER_COLORS } from "./useProductivity";

describe("buildChartData", () => {
  it("aggregates points by bucket", () => {
    const sprintPoints = [
      { bucket: "2026-05-01", userId: 1, points: 10 },
      { bucket: "2026-05-01", userId: 2, points: 5 },
      { bucket: "2026-05-02", userId: 1, points: 8 },
    ];
    const members = [
      { clickup_user_id: 1, full_name: "Alice" },
      { clickup_user_id: 2, full_name: "Bob" },
    ] as any[];

    const result = buildChartData(sprintPoints, members);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ bucket: "2026-05-01", "1": 10, "2": 5 });
    expect(result[1]).toMatchObject({ bucket: "2026-05-02", "1": 8 });
  });

  it("returns empty array for empty input", () => {
    expect(buildChartData([], [])).toEqual([]);
  });
});

describe("MEMBER_COLORS", () => {
  it("has at least 7 colours", () => {
    expect(MEMBER_COLORS.length).toBeGreaterThanOrEqual(7);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- useProductivity
```

Expected: FAIL — `buildChartData` and `MEMBER_COLORS` not found

- [ ] **Step 3: Write the hook**

```ts
// src/hooks/useProductivity.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

export type View = "year" | "month" | "week";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

export interface SprintPoint {
  bucket: string;
  userId: number;
  points: number;
}

export interface TimeEntry {
  bucket: string;
  userId: number;
  hours: number;
}

export interface ProductivityMeta {
  periodLabel: string;
  totalPoints: number;
  totalHours: number;
  dailyAvg: number;
  activeContributors: number;
}

export interface ProductivityData {
  sprintPoints: SprintPoint[];
  timeEntries: TimeEntry[];
  meta: ProductivityMeta;
}

export const MEMBER_COLORS = [
  "#7C3AED",
  "#EC4899",
  "#0891B2",
  "#059669",
  "#D97706",
  "#E11D48",
  "#4F46E5",
];

/** Transforms flat sprintPoints rows into recharts-friendly shape:
 *  [{ bucket, [userId]: points, ... }, ...] */
export function buildChartData(
  sprintPoints: SprintPoint[],
  members: Pick<TeamMember, "clickup_user_id" | "full_name">[],
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const sp of sprintPoints) {
    const row = byBucket.get(sp.bucket) ?? { bucket: sp.bucket };
    row[String(sp.userId)] = ((row[String(sp.userId)] as number) ?? 0) + sp.points;
    byBucket.set(sp.bucket, row);
  }
  return Array.from(byBucket.values()).sort((a, b) =>
    String(a.bucket).localeCompare(String(b.bucket)),
  );
}

/** Transforms flat timeEntries rows into recharts-friendly shape:
 *  [{ bucket, hours }, ...] */
export function buildHoursData(
  timeEntries: TimeEntry[],
): { bucket: string; hours: number }[] {
  const byBucket = new Map<string, number>();
  for (const te of timeEntries) {
    byBucket.set(te.bucket, (byBucket.get(te.bucket) ?? 0) + te.hours);
  }
  return Array.from(byBucket.entries())
    .map(([bucket, hours]) => ({ bucket, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export function useProductivity(
  view: View,
  date: string,
  clickupUserId?: number,
) {
  return useQuery<ProductivityData>({
    queryKey: ["productivity", view, date, clickupUserId ?? "team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-productivity", {
        body: { view, date, clickup_user_id: clickupUserId },
      });
      if (error) throw error;
      return data as ProductivityData;
    },
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- useProductivity
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProductivity.ts src/hooks/useProductivity.test.ts
git commit -m "feat(productivity): add useProductivity hook"
```

---

## Task 5: Install recharts

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install recharts**

```bash
npm install recharts
```

Expected: recharts added to dependencies in package.json

- [ ] **Step 2: Confirm TypeScript types are available**

```bash
npx tsc --noEmit 2>&1 | grep recharts
```

Expected: no output (types bundled with recharts)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(productivity): install recharts"
```

---

## Task 6: TeamSidebar component

**Files:**
- Create: `src/components/productivity/TeamSidebar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/TeamSidebar.tsx
import { Users } from "lucide-react";
import { MEMBER_COLORS } from "@/hooks/useProductivity";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

interface Props {
  members: TeamMember[];
  selectedUserId: number | null; // null = whole team
  onSelect: (userId: number | null) => void;
  pointsByMember: Record<number, number>; // clickup_user_id → total points
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TeamSidebar({ members, selectedUserId, onSelect, pointsByMember }: Props) {
  const isTeam = selectedUserId === null;

  const totalPoints = Object.values(pointsByMember).reduce((s, v) => s + v, 0);

  return (
    <aside className="w-44 shrink-0 border-r border-m-outline-variant bg-m-surface px-2 py-4 flex flex-col gap-0.5 sticky top-0 h-screen overflow-y-auto">
      <p className="px-3 mb-2 text-label-small font-semibold uppercase tracking-widest text-m-on-surface-variant">
        Team
      </p>

      {/* Whole team row */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-label-large transition-colors ${
          isTeam
            ? "bg-m-primary-container font-semibold text-m-on-primary-container"
            : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
        }`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-m-surface-container-high text-m-on-surface-variant">
          <Users className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 truncate">Whole team</span>
        <span className="text-label-small tabular-nums opacity-60">{totalPoints}</span>
      </button>

      {/* Member rows */}
      {members.map((member, idx) => {
        const isActive = selectedUserId === member.clickup_user_id;
        const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];
        const pts = member.clickup_user_id ? (pointsByMember[member.clickup_user_id] ?? 0) : 0;
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => member.clickup_user_id && onSelect(member.clickup_user_id)}
            disabled={!member.clickup_user_id}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-label-large transition-colors ${
              isActive
                ? "bg-m-primary-container font-semibold text-m-on-primary-container"
                : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
              style={{ background: color }}
            >
              {initials(member.full_name)}
            </span>
            <span className="flex-1 truncate">{member.full_name.split(" ")[0]}</span>
            <span className="text-label-small tabular-nums opacity-60">{pts}</span>
          </button>
        );
      })}
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/TeamSidebar.tsx
git commit -m "feat(productivity): add TeamSidebar component"
```

---

## Task 7: ProductivityControls component

**Files:**
- Create: `src/components/productivity/ProductivityControls.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/ProductivityControls.tsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { View } from "@/hooks/useProductivity";

interface Props {
  view: View;
  date: string;       // ISO date string
  periodLabel: string;
  onViewChange: (v: View) => void;
  onDateChange: (d: string) => void;
}

const VIEWS: View[] = ["year", "month", "week"];

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function navigate(view: View, date: string, direction: 1 | -1): string {
  // Parse as local midnight to avoid UTC-offset day-shift
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  if (view === "year") {
    dt.setFullYear(dt.getFullYear() + direction);
  } else if (view === "month") {
    dt.setMonth(dt.getMonth() + direction);
  } else {
    dt.setDate(dt.getDate() + direction * 7);
  }
  return toLocalISO(dt);
}

export function ProductivityControls({ view, date, periodLabel, onViewChange, onDateChange }: Props) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-headline-medium text-m-on-surface">Productivity</h1>

      <div className="flex items-center gap-3">
        {/* Date navigator */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onDateChange(navigate(view, date, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-m-on-surface-variant hover:bg-m-surface-container transition-colors"
            aria-label="Previous period"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-32 text-center text-body-medium font-medium text-m-on-surface">
            {periodLabel}
          </span>
          <button
            type="button"
            onClick={() => onDateChange(navigate(view, date, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-m-on-surface-variant hover:bg-m-surface-container transition-colors"
            aria-label="Next period"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* View tabs */}
        <div className="flex items-center rounded-full bg-m-surface-container p-1 gap-0.5">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              className={`px-4 py-1.5 rounded-full text-label-large capitalize transition-colors ${
                view === v
                  ? "bg-m-primary text-m-on-primary font-semibold shadow-sm"
                  : "text-m-on-surface-variant hover:text-m-on-surface"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/ProductivityControls.tsx
git commit -m "feat(productivity): add ProductivityControls component"
```

---

## Task 8: MetricCards component

**Files:**
- Create: `src/components/productivity/MetricCards.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/MetricCards.tsx
import type { ProductivityMeta } from "@/hooks/useProductivity";

interface Props {
  meta: ProductivityMeta;
  goalPoints: number;
}

export function MetricCards({ meta, goalPoints }: Props) {
  const pct = goalPoints > 0 ? meta.dailyAvg / goalPoints : 0;
  const avgColor =
    pct >= 1 ? "text-[#34d399]" : pct >= 0.9 ? "text-[#fbbf24]" : "text-[#f87171]";

  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">
          Points
        </p>
        <p className="mt-1 text-2xl font-bold text-m-on-surface">
          {meta.totalPoints}
          <span className="ml-1 text-sm font-normal text-m-on-surface-variant">pts</span>
        </p>
      </div>

      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">
          Daily avg
        </p>
        <p className={`mt-1 text-2xl font-bold ${avgColor}`}>
          {meta.dailyAvg}
          <span className="ml-1 text-sm font-normal text-m-on-surface-variant">
            / {goalPoints} goal
          </span>
        </p>
      </div>

      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">
          Hours tracked
        </p>
        <p className="mt-1 text-2xl font-bold text-m-on-surface">
          {meta.totalHours}
          <span className="ml-1 text-sm font-normal text-m-on-surface-variant">hrs</span>
        </p>
      </div>

      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">
          Contributors
        </p>
        <p className="mt-1 text-2xl font-bold text-m-on-surface">
          {meta.activeContributors}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/MetricCards.tsx
git commit -m "feat(productivity): add MetricCards component"
```

---

## Task 9: SprintPointsChart component

**Files:**
- Create: `src/components/productivity/SprintPointsChart.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/SprintPointsChart.tsx
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { MEMBER_COLORS } from "@/hooks/useProductivity";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

interface Props {
  data: Record<string, number | string>[];
  members: TeamMember[];
  goalPoints: number;
  selectedUserId: number | null;
}

export function SprintPointsChart({ data, members, goalPoints, selectedUserId }: Props) {
  const activeMembersWithClickUp = members.filter((m) => m.clickup_user_id !== null);

  const displayMembers =
    selectedUserId !== null
      ? activeMembersWithClickUp.filter((m) => m.clickup_user_id === selectedUserId)
      : activeMembersWithClickUp;

  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
      <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">Output</p>
      <p className="mt-0.5 text-title-medium font-semibold text-m-on-surface">Sprint Points</p>
      <div className="mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#1e2433",
                border: "1px solid #2d3748",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#e2e8f0", marginBottom: 4 }}
              itemStyle={{ color: "#94a3b8" }}
            />
            <ReferenceLine
              y={goalPoints}
              stroke="#f59e0b"
              strokeDasharray="5 3"
              label={{ value: `Goal ${goalPoints}`, position: "right", fill: "#f59e0b", fontSize: 10 }}
            />
            {displayMembers.map((member, idx) => {
              const originalIdx = activeMembersWithClickUp.findIndex(
                (m) => m.id === member.id,
              );
              const color = MEMBER_COLORS[originalIdx % MEMBER_COLORS.length];
              return (
                <Bar
                  key={member.id}
                  dataKey={String(member.clickup_user_id)}
                  name={member.full_name}
                  stackId="a"
                  fill={color}
                  radius={idx === displayMembers.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              );
            })}
            {displayMembers.length > 1 && (
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(value) => (
                  <span style={{ color: "#94a3b8" }}>{value}</span>
                )}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/SprintPointsChart.tsx
git commit -m "feat(productivity): add SprintPointsChart component"
```

---

## Task 10: HoursTrackedChart component

**Files:**
- Create: `src/components/productivity/HoursTrackedChart.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/HoursTrackedChart.tsx
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: { bucket: string; hours: number }[];
}

export function HoursTrackedChart({ data }: Props) {
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
      <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">Effort</p>
      <p className="mt-0.5 text-title-medium font-semibold text-m-on-surface">Hours Tracked</p>
      <div className="mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#1e2433",
                border: "1px solid #2d3748",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#e2e8f0", marginBottom: 4 }}
              formatter={(value: number) => [`${value.toFixed(1)} hrs`, "Hours"]}
              itemStyle={{ color: "#94a3b8" }}
            />
            <Bar
              dataKey="hours"
              name="Hours"
              fill="#3b82f6"
              fillOpacity={0.8}
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/HoursTrackedChart.tsx
git commit -m "feat(productivity): add HoursTrackedChart component"
```

---

## Task 11: ProductivityPage — assemble everything

**Files:**
- Create: `src/pages/ProductivityPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/pages/ProductivityPage.tsx
import { useState } from "react";
import { useTeam } from "@/hooks/useTeam";
import { useSettings } from "@/hooks/useSettings";
import { useProductivity, buildChartData, buildHoursData } from "@/hooks/useProductivity";
import type { View } from "@/hooks/useProductivity";
import { TeamSidebar } from "@/components/productivity/TeamSidebar";
import { ProductivityControls } from "@/components/productivity/ProductivityControls";
import { MetricCards } from "@/components/productivity/MetricCards";
import { SprintPointsChart } from "@/components/productivity/SprintPointsChart";
import { HoursTrackedChart } from "@/components/productivity/HoursTrackedChart";

export function ProductivityPage() {
  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  });
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const { data: members = [] } = useTeam();
  const { data: settings } = useSettings();
  const goalPoints = settings?.productivity_goal_points ?? 40;

  const { data, isLoading, isError } = useProductivity(
    view,
    date,
    selectedUserId ?? undefined,
  );

  const sprintChartData = data ? buildChartData(data.sprintPoints, members) : [];
  const hoursChartData = data ? buildHoursData(data.timeEntries) : [];

  // Build per-member point totals for sidebar chips
  const pointsByMember: Record<number, number> = {};
  for (const sp of data?.sprintPoints ?? []) {
    pointsByMember[sp.userId] = (pointsByMember[sp.userId] ?? 0) + sp.points;
  }

  const defaultMeta = {
    periodLabel: "",
    totalPoints: 0,
    totalHours: 0,
    dailyAvg: 0,
    activeContributors: 0,
  };

  return (
    <div className="flex h-full">
      <TeamSidebar
        members={members}
        selectedUserId={selectedUserId}
        onSelect={setSelectedUserId}
        pointsByMember={pointsByMember}
      />

      <main className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        <ProductivityControls
          view={view}
          date={date}
          periodLabel={data?.meta.periodLabel ?? ""}
          onViewChange={setView}
          onDateChange={setDate}
        />

        {isError && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-medium text-destructive">
            Failed to load productivity data. Check that ClickUp is enabled in Settings.
          </p>
        )}

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-body-medium text-m-on-surface-variant">
            Loading…
          </div>
        ) : (
          <>
            <MetricCards meta={data?.meta ?? defaultMeta} goalPoints={goalPoints} />
            <SprintPointsChart
              data={sprintChartData}
              members={members}
              goalPoints={goalPoints}
              selectedUserId={selectedUserId}
            />
            <HoursTrackedChart data={hoursChartData} />
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/ProductivityPage.tsx
git commit -m "feat(productivity): add ProductivityPage"
```

---

## Task 12: Routing + nav item

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/nav/navItems.ts`

- [ ] **Step 1: Add the lazy route to App.tsx**

Add after the existing lazy imports:

```ts
const ProductivityPage = lazy(() =>
  import("@/pages/ProductivityPage").then((m) => ({ default: m.ProductivityPage })),
);
```

Add inside the `<Route element={<AppShell />}>` group after the `reconciliation` route:

```tsx
<Route path="productivity" element={<ProductivityPage />} />
```

- [ ] **Step 2: Add the nav item to navItems.ts**

Add `TrendingUp` to the lucide-react import, then add to the `navItems` array after `"pulse"`:

```ts
import {
  BookOpen,
  Building2,
  FileBarChart2,
  FolderKanban,
  LayoutDashboard,
  Inbox as InboxIcon,
  PackageSearch,
  Settings as SettingsIcon,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react"
```

```ts
{ to: "/productivity", label: "Productivity", icon: TrendingUp, end: false, gradient: "linear-gradient(135deg, #059669, #0891B2)", color: "#059669" },
```

- [ ] **Step 3: Verify in the browser**

With `npm run dev` running, open `http://localhost:5174`. Confirm:
- "Productivity" appears in the nav icon rail
- Clicking it navigates to `/productivity`
- Left sidebar shows "Whole team" + all team members
- View tabs (Year / Month / Week) and date navigator render
- Charts render (may be empty if no ClickUp data for current period — that's expected)
- Clicking a team member filters the sprint points chart and updates sidebar highlight
- Navigating to prev/next period updates the period label

- [ ] **Step 4: Final commit**

```bash
git add src/App.tsx src/components/nav/navItems.ts
git commit -m "feat(productivity): wire up routing and nav item"
```
