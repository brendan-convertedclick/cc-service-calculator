# Parallel Session Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the meaningless parallel session bar grid with a time-of-day heatmap that answers "when during the day were you running the most concurrent AI sessions?"

**Architecture:** The edge function computes approximate session start times (`created_at − ai_duration_minutes`) and buckets each session into 1-hour slots (SAST = UTC+2). The frontend renders a grid: Y = hour of day (5am–11pm), X = days in period, cell colour intensity = concurrent sessions in that slot. Wall-clock hours = distinct hour slots with any activity; total AI hours = raw sum of session durations.

**Tech Stack:** TypeScript, React 18, Tailwind, shadcn/ui, Supabase Edge Functions (Deno), TanStack Query

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/hooks/useOutputMultiplier.ts` | Modify | Replace `ParallelDay`/`ParallelSession` with `HeatmapCell`/new `ParallelData` |
| `src/components/productivity/OutputMultiplierShell.tsx` | Modify | Update type guard `"days" in data` → `"heatmap" in data` |
| `src/components/productivity/ParallelView.tsx` | Rewrite | Heatmap grid component |
| `supabase/functions/get-output-multiplier/index.ts` | Modify + Deploy | `parallelView` returns heatmap instead of days array |

---

## Task 1: Update types in `useOutputMultiplier.ts`

**Files:**
- Modify: `src/hooks/useOutputMultiplier.ts`

- [ ] **Step 1: Replace the old parallel types with heatmap types**

Open `src/hooks/useOutputMultiplier.ts`. Remove the `ParallelSession` and `ParallelDay` interfaces entirely. Replace `ParallelData` with:

```typescript
export interface HeatmapCell {
  ai_sessions: number;   // concurrent sessions active in this hour slot
  human_minutes: number; // ClickUp time logged in this hour slot
}

export interface ParallelData {
  periodLabel: string;
  // date (YYYY-MM-DD) -> hour (0-23) -> cell
  heatmap: Record<string, Record<number, HeatmapCell>>;
  summary: {
    peak_concurrent: number;  // max sessions in any single hour slot
    peak_hour: number;        // 0-23 local time (SAST)
    total_ai_hours: number;   // sum of all session durations / 60
    wall_clock_hours: number; // distinct hour slots with ai_sessions > 0
    active_hours: number;     // same as wall_clock_hours (for chip display)
  };
}
```

Also remove `computeBubbleRadii` and `BubbleRadii` if they were only used by the old parallel view (check for usages first with grep before removing).

- [ ] **Step 2: Verify the hook still compiles**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
npx tsc --noEmit 2>&1 | head -40
```

Expected: errors only about `ParallelView.tsx` and `OutputMultiplierShell.tsx` (downstream consumers of the changed type) — not about the hook itself.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useOutputMultiplier.ts
git commit -m "refactor(parallel): replace ParallelDay/ParallelSession with HeatmapCell types"
```

---

## Task 2: Update `OutputMultiplierShell.tsx` type guard

**Files:**
- Modify: `src/components/productivity/OutputMultiplierShell.tsx`

- [ ] **Step 1: Update the type guard for the parallel view**

Find this line:
```tsx
{view === "parallel" && "days" in data && <ParallelView data={data} />}
```

Replace with:
```tsx
{view === "parallel" && "heatmap" in data && <ParallelView data={data} />}
```

The `OutputMultiplierData` union is `DirectData | ParallelData | PassiveData`. The discriminant field changes from `days` (old) to `heatmap` (new).

- [ ] **Step 2: Verify no other references to the old `ParallelDay`/`ParallelSession` types**

```bash
grep -r "ParallelDay\|ParallelSession\|\.days" src/ --include="*.tsx" --include="*.ts"
```

Expected: zero matches (all references removed).

- [ ] **Step 3: Commit**

```bash
git add src/components/productivity/OutputMultiplierShell.tsx
git commit -m "refactor(parallel): update type guard from 'days' to 'heatmap'"
```

---

## Task 3: Rewrite `ParallelView.tsx` as a heatmap

**Files:**
- Rewrite: `src/components/productivity/ParallelView.tsx`

The question this view answers: **"At what hours of the day were you running the most concurrent AI sessions?"**

- [ ] **Step 1: Write the complete component**

Replace the entire file with:

```tsx
// src/components/productivity/ParallelView.tsx
import { HeatmapCell, ParallelData } from "@/hooks/useOutputMultiplier";

// Hours shown on Y axis (5am = 5, 11pm = 23)
const MIN_HOUR = 5;
const MAX_HOUR = 23;

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function formatDayHeader(dateStr: string): string {
  const [y, mo, da] = dateStr.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${day} ${da}`;
}

function cellColorClass(sessions: number, peak: number): string {
  if (sessions === 0) return "bg-m-surface-container-high/60";
  if (peak <= 0) return "bg-violet-400/50";
  const ratio = sessions / peak;
  if (ratio <= 0.33) return "bg-violet-300/60 border-violet-400/30";
  if (ratio <= 0.66) return "bg-violet-500/70 border-violet-500/40";
  return "bg-violet-700/85 border-violet-600/50";
}

interface Props {
  data: ParallelData;
}

export function ParallelView({ data }: Props) {
  const { heatmap, summary, periodLabel } = data;

  const dates = Object.keys(heatmap).sort();
  const hours = Array.from({ length: MAX_HOUR - MIN_HOUR + 1 }, (_, i) => i + MIN_HOUR);

  if (dates.length === 0) {
    return (
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-12 text-center text-body-medium text-m-on-surface-variant/40">
        No sessions logged for this period.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3">
        <Chip
          label="Peak concurrent"
          value={`${summary.peak_concurrent}×`}
          sub={`at ${formatHour(summary.peak_hour)} local`}
        />
        <Chip
          label="Total AI output"
          value={`${summary.total_ai_hours}h`}
          sub={`wall-clock ≈ ${summary.wall_clock_hours}h`}
        />
        <Chip
          label="Active hour slots"
          value={String(summary.active_hours)}
          sub="hours with AI sessions running"
        />
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6 overflow-x-auto">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
          AI activity by hour — {periodLabel}
        </p>
        <p className="text-body-small text-m-on-surface-variant/60 mb-5">
          Rows = hour of day (local time). Columns = days. Darker = more concurrent sessions running.
        </p>

        <div
          className="grid gap-px"
          style={{
            gridTemplateColumns: `52px repeat(${dates.length}, minmax(56px, 1fr))`,
          }}
        >
          {/* Column headers */}
          <div />
          {dates.map((d) => (
            <div
              key={d}
              className="text-label-small text-m-on-surface-variant text-center pb-2"
            >
              {formatDayHeader(d)}
            </div>
          ))}

          {/* Hour rows */}
          {hours.map((hour) => (
            <>
              <div
                key={`label-${hour}`}
                className="text-body-small text-m-on-surface-variant/50 text-right pr-2.5 flex items-center justify-end h-8"
              >
                {formatHour(hour)}
              </div>
              {dates.map((date) => {
                const cell: HeatmapCell = heatmap[date]?.[hour] ?? {
                  ai_sessions: 0,
                  human_minutes: 0,
                };
                const hasHuman = cell.human_minutes > 0;
                return (
                  <div
                    key={`${date}-${hour}`}
                    className={[
                      "h-8 rounded-sm border transition-colors relative",
                      cellColorClass(cell.ai_sessions, summary.peak_concurrent),
                    ].join(" ")}
                    title={[
                      `${formatDayHeader(date)} ${formatHour(hour)}`,
                      `${cell.ai_sessions} concurrent session${cell.ai_sessions !== 1 ? "s" : ""}`,
                      hasHuman ? `${Math.round(cell.human_minutes)}min human time` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {/* Dot indicating human time was also logged this hour */}
                    {hasHuman && (
                      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-white/60" />
                    )}
                  </div>
                );
              })}
            </>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-5 flex items-center gap-5 flex-wrap">
          <span className="text-body-small text-m-on-surface-variant/50">Intensity:</span>
          {[
            { label: "None", sessions: 0 },
            { label: "1 session", sessions: 1 },
            { label: "2 sessions", sessions: 2 },
            { label: "3+", sessions: 3 },
          ].map(({ label, sessions }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div
                className={`w-5 h-5 rounded-sm border ${cellColorClass(sessions, 3)}`}
              />
              <span className="text-body-small text-m-on-surface-variant/60">{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-sm border bg-violet-500/70 relative">
              <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white/60" />
            </div>
            <span className="text-body-small text-m-on-surface-variant/60">+ human time logged</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container-high p-4">
      <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className="text-headline-small text-m-on-surface font-bold">{value}</p>
      <p className="text-body-small text-m-on-surface-variant/60 mt-0.5">{sub}</p>
    </div>
  );
}
```

- [ ] **Step 2: Check TypeScript**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
npx tsc --noEmit 2>&1 | head -40
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/productivity/ParallelView.tsx
git commit -m "feat(parallel): replace bar grid with time-of-day heatmap component"
```

---

## Task 4: Update and deploy the edge function `parallelView`

**Files:**
- Modify: `supabase/functions/get-output-multiplier/index.ts` (local copy only — for reference)
- Deploy via MCP: `mcp__cc-supabase__deploy_edge_function`

The key change: instead of returning `{ days, summary }`, return `{ heatmap, summary }`.

**How hour-bucketing works:**
- Each session: `end_ms = created_at`, `start_ms = end_ms − ai_duration_minutes × 60000`
- Walk from `floor(start_ms / 3600000) × 3600000` to `end_ms` in 1h steps
- For each step, convert to SAST (UTC+2) to get local hour
- Increment `heatmap[localDate][localHour].ai_sessions`

**Wall-clock hours** = count of distinct `(date, hour)` slots where `ai_sessions > 0`  
**Total AI hours** = sum of `ai_duration_minutes / 60` across all sessions  
**Peak hour** = the local hour (0–23) that has the highest `ai_sessions` summed across all days

- [ ] **Step 1: Update `parallelView` in the local edge function file**

Replace the `parallelView` function in `supabase/functions/get-output-multiplier/index.ts` with:

```typescript
async function parallelView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  logged_by?: string,
) {
  const TZ_OFFSET_MS = 2 * 3600 * 1000; // SAST = UTC+2

  // ── Fetch AI sessions ──────────────────────────────────────────────────
  let query = sb
    .from("ai_sessions")
    .select("session_date, project_slug, ai_duration_minutes, created_at, logged_by")
    .gte("session_date", pr.startDate)
    .lt("session_date", pr.endDate)
    .eq("engagement_type", "task")
    .gte("ai_duration_minutes", 1)
    .order("created_at");

  if (logged_by) query = query.eq("logged_by", logged_by);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // ── Fetch ClickUp human time entries ──────────────────────────────────
  const [settingsResult, teamResult] = await Promise.all([
    sb.from("settings").select("clickup_enabled, clickup_workspace_id").eq("id", 1).single(),
    sb.from("team_members").select("email, clickup_user_id").not("clickup_user_id", "is", null),
  ]);

  const clickupIdToEmail = new Map<number, string>();
  for (const tm of teamResult.data ?? []) {
    if (tm.clickup_user_id) clickupIdToEmail.set(Number(tm.clickup_user_id), tm.email);
  }

  // heatmap[localDate][localHour] = { ai_sessions, human_minutes }
  type Cell = { ai_sessions: number; human_minutes: number };
  const heatmap: Record<string, Record<number, Cell>> = {};

  function ensureCell(dateKey: string, hour: number): Cell {
    if (!heatmap[dateKey]) heatmap[dateKey] = {};
    if (!heatmap[dateKey][hour]) heatmap[dateKey][hour] = { ai_sessions: 0, human_minutes: 0 };
    return heatmap[dateKey][hour];
  }

  // ── Bucket AI sessions by hour ─────────────────────────────────────────
  let totalAiMinutes = 0;
  for (const row of data ?? []) {
    const durationMin = Number(row.ai_duration_minutes);
    totalAiMinutes += durationMin;
    const endMs = new Date(row.created_at as string).getTime();
    const startMs = endMs - durationMin * 60_000;

    // Walk hour boundaries (UTC), then convert to local for bucketing
    let cursor = Math.floor(startMs / 3_600_000) * 3_600_000;
    while (cursor < endMs) {
      const localMs = cursor + TZ_OFFSET_MS;
      const ld = new Date(localMs);
      const dateKey = `${ld.getUTCFullYear()}-${String(ld.getUTCMonth() + 1).padStart(2, "0")}-${String(ld.getUTCDate()).padStart(2, "0")}`;
      const localHour = ld.getUTCHours();
      ensureCell(dateKey, localHour).ai_sessions++;
      cursor += 3_600_000;
    }
  }

  // ── Bucket ClickUp human time by hour ─────────────────────────────────
  const settings = settingsResult.data;
  if (settings?.clickup_enabled && settings?.clickup_workspace_id) {
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (clickupPat) {
      const startMs = new Date(pr.startDate).getTime();
      const endMs = new Date(pr.endDate).getTime();
      const timeParams = new URLSearchParams({
        start_date: String(startMs),
        end_date: String(endMs),
      });
      if (logged_by) {
        // find clickup user id for this email
        for (const tm of teamResult.data ?? []) {
          if (tm.email === logged_by && tm.clickup_user_id) {
            timeParams.append("assignee", String(tm.clickup_user_id));
          }
        }
      }
      const timeRes = await fetch(
        `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/time_entries?${timeParams}`,
        { headers: { Authorization: clickupPat } },
      );
      if (timeRes.ok) {
        const timeBody = await timeRes.json() as {
          data: Array<{ duration: string; start: string; user: { id: number } }>;
        };
        for (const entry of timeBody.data ?? []) {
          const email = clickupIdToEmail.get(Number(entry.user.id));
          if (!email) continue;
          if (logged_by && email !== logged_by) continue;
          const entryStartMs = Number(entry.start);
          const localMs = entryStartMs + TZ_OFFSET_MS;
          const ld = new Date(localMs);
          const dateKey = `${ld.getUTCFullYear()}-${String(ld.getUTCMonth() + 1).padStart(2, "0")}-${String(ld.getUTCDate()).padStart(2, "0")}`;
          const localHour = ld.getUTCHours();
          ensureCell(dateKey, localHour).human_minutes += Number(entry.duration) / 60_000;
        }
      }
    }
  }

  // ── Compute summary ────────────────────────────────────────────────────
  let peakConcurrent = 0;
  let peakHour = 9;
  let activeHours = 0;
  const hourSums: Record<number, number> = {};

  for (const dayData of Object.values(heatmap)) {
    for (const [hourStr, cell] of Object.entries(dayData)) {
      const h = Number(hourStr);
      if (cell.ai_sessions > 0) {
        activeHours++;
        hourSums[h] = (hourSums[h] ?? 0) + cell.ai_sessions;
        if (cell.ai_sessions > peakConcurrent) {
          peakConcurrent = cell.ai_sessions;
          peakHour = h;
        }
      }
    }
  }

  const totalAiHours = Math.round(totalAiMinutes / 60 * 10) / 10;
  const wallClockHours = activeHours; // 1 distinct hour slot = 1 wall-clock hour

  return json({
    periodLabel: pr.label,
    heatmap,
    summary: {
      peak_concurrent: peakConcurrent,
      peak_hour: peakHour,
      total_ai_hours: totalAiHours,
      wall_clock_hours: wallClockHours,
      active_hours: activeHours,
    },
  });
}
```

- [ ] **Step 2: Deploy via MCP**

Use `mcp__cc-supabase__deploy_edge_function` with the full inlined index.ts (same pattern as previous deployments — inline all shared helpers since the MCP bundler can't resolve `../` paths).

Confirm: response shows `"status": "ACTIVE"` and a new version number.

- [ ] **Step 3: Smoke-test the edge function**

```bash
curl -s -X POST \
  "https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/get-output-multiplier" \
  -H "Content-Type: application/json" \
  -d '{"view":"parallel","period":"week","date":"2026-05-12"}' | python3 -m json.tool | head -60
```

Expected: response has `heatmap` key with date → hour → `{ai_sessions, human_minutes}` structure, and `summary` with `peak_concurrent`, `peak_hour`, `total_ai_hours`, `wall_clock_hours`, `active_hours`.

- [ ] **Step 4: Commit the local edge function file**

```bash
git add supabase/functions/get-output-multiplier/index.ts
git commit -m "feat(parallel): return hour-bucketed heatmap from parallelView edge function"
```

---

## Task 5: Visual QA with Playwright

- [ ] **Step 1: Navigate to the Parallel tab**

Use `mcp__plugin_playwright_playwright__browser_navigate` → `http://localhost:5174/productivity`, then click Parallel.

- [ ] **Step 2: Take a full-page screenshot**

Use `mcp__plugin_playwright_playwright__browser_take_screenshot` with `fullPage: true`.

**What to verify:**
1. Heatmap grid renders — Y axis shows hour labels (5am … 11pm), X axis shows day labels (Tue 12)
2. Cells are coloured — darker cells appear in the hours when sessions ran today
3. Chips show sensible numbers: peak_concurrent ≤ 7, active_hours roughly matches expected working hours
4. No "Loading…" state stuck — data arrived
5. No console errors related to undefined `days` property

- [ ] **Step 3: Hover a cell and verify tooltip**

Use `mcp__plugin_playwright_playwright__browser_snapshot` to find a dark cell. Use `mcp__plugin_playwright_playwright__browser_hover` on it and screenshot again to verify tooltip content matches expected format: `"Tue 12 · 10am · 2 concurrent sessions"`.

- [ ] **Step 4: Fix any visual issues found**

Common issues to check:
- If all cells are empty → edge function returning wrong date keys (check TZ offset)
- If TypeScript error → check `HeatmapCell` import in `ParallelView.tsx`
- If peak_hour shows wrong time → check `TZ_OFFSET_MS` in edge function

---

## Self-Review

**Spec coverage:**
- ✅ Y axis = hours of day (5am–11pm) 
- ✅ X axis = days (week view)
- ✅ Cell intensity = concurrent sessions at that hour
- ✅ Human time logged shown as dot overlay
- ✅ Summary chips: peak concurrent, total AI output, wall-clock, active hours
- ✅ Question answered: "when were you creating the most leverage?"
- ✅ No MAX_SLOTS cap — all sessions bucketed into hours

**Placeholder scan:** None found.

**Type consistency:**
- `HeatmapCell` defined in Task 1, used in Task 3 ✅
- `ParallelData.heatmap` is `Record<string, Record<number, HeatmapCell>>` — matches edge function output ✅
- `summary.peak_hour` is `number` (0-23) — `formatHour(summary.peak_hour)` handles 0-23 ✅
- `"heatmap" in data` type guard in Task 2 matches `ParallelData` shape ✅
