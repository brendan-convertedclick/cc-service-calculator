# Output Multiplier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Output Multiplier" tab to `/productivity` with three sub-views (Direct, Parallel, Passive) that measure how much AI amplifies each team member's output, backed by a new `ai_sessions` Supabase table populated via `/log`.

**Architecture:** New Supabase tables (`ai_sessions`, `agents`) are the data store. Two new edge functions handle writes (`log-ai-session`) and reads (`get-output-multiplier`, branching on `view`). A TanStack Query hook (`useOutputMultiplier`) feeds four new React components that are added as a second top-level tab on the existing `ProductivityPage`. Bubble chart is pure SVG — no new charting library.

**Tech Stack:** Supabase Postgres + Deno Edge Functions, TanStack Query, React 18, TypeScript, SVG, Vitest.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/0038_ai_sessions.sql` | Tables, seed data, settings column |
| Create | `supabase/functions/_shared/output-multiplier-logic.ts` | Pure: `periodRange`, `computeMultiplier` |
| Create | `supabase/functions/_shared/output-multiplier-logic.test.ts` | Unit tests for pure logic |
| Create | `supabase/functions/log-ai-session/index.ts` | Write `ai_sessions` row + patch ClickUp |
| Create | `supabase/functions/get-output-multiplier/index.ts` | Serve all three views |
| Create | `src/hooks/useOutputMultiplier.ts` | Types, pure `computeBubbleRadii`, TanStack Query hook |
| Create | `src/hooks/useOutputMultiplier.test.ts` | Unit tests for `computeBubbleRadii` + `computeMultiplier` |
| Create | `src/components/productivity/DirectView.tsx` | SVG concentric ring bubble chart |
| Create | `src/components/productivity/ParallelView.tsx` | Session concurrency grid |
| Create | `src/components/productivity/PassiveView.tsx` | Agent leaderboard table |
| Create | `src/components/productivity/OutputMultiplierShell.tsx` | Sub-tab switcher + period nav + chip wrapper |
| Modify | `src/pages/ProductivityPage.tsx` | Add top-level page tab switcher |
| Modify | `src/pages/Settings.tsx` | Add blended hourly rate input |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/0038_ai_sessions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0038_ai_sessions.sql

-- Agent registry: CC skills with creator + estimated human time per run
create table if not exists agents (
  id                           text primary key,
  name                         text not null,
  description                  text not null,
  creator                      text not null,
  created_at                   date not null,
  estimated_human_hours_per_run numeric(5,2) not null default 0.5
);

-- Seed the 5 existing CC agents
insert into agents (id, name, description, creator, created_at, estimated_human_hours_per_run) values
  ('skill-intake',    '/intake',    'Email triage — scans Gmail, classifies, creates briefs',       'brendan@convertedclick.co.za', '2026-03-01', 0.5),
  ('skill-log',       '/log',       'Retroactive task logging to ClickUp',                          'brendan@convertedclick.co.za', '2026-03-01', 0.25),
  ('skill-brief',     '/brief',     'Issue pre-scoped tasks to team via ClickUp',                   'brendan@convertedclick.co.za', '2026-03-01', 0.5),
  ('skill-scheduler', '/scheduler', 'Task estimation + sprint burn reporting',                      'brendan@convertedclick.co.za', '2026-03-01', 0.5),
  ('skill-sow',       '/sow',       'Scope of work creation + quoting',                            'brendan@convertedclick.co.za', '2026-03-01', 1.0)
on conflict (id) do nothing;

-- AI session log: one row per Claude Code session logged via /log
create table if not exists ai_sessions (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  logged_by           text not null,
  session_date        date not null,
  clickup_task_id     text,
  project_slug        text,
  ai_input_tokens     integer not null default 0,
  ai_output_tokens    integer not null default 0,
  ai_duration_minutes numeric(8,2) not null default 0,
  ai_cost_zar         numeric(10,2) not null default 0,
  human_minutes       numeric(8,2) not null default 0,
  concurrent_sessions integer not null default 1,
  engagement_type     text not null default 'task'
                        check (engagement_type in ('task', 'agent-run')),
  agent_id            text references agents(id)
);

create index if not exists ai_sessions_logged_by_date
  on ai_sessions (logged_by, session_date);
create index if not exists ai_sessions_engagement_type
  on ai_sessions (engagement_type);

-- Settings: blended hourly rate for passive cost equivalents (ZAR)
alter table settings
  add column if not exists blended_hourly_rate_zar integer not null default 350;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push --project-ref lpgwxacoqiqpcfpkklib
```

Expected: `Applied 1 migration` with no errors.

- [ ] **Step 3: Verify tables exist**

In the Supabase dashboard or via psql, run:
```sql
select count(*) from agents;   -- should be 5
select count(*) from ai_sessions;  -- should be 0
select blended_hourly_rate_zar from settings limit 1;  -- should be 350
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0038_ai_sessions.sql
git commit -m "feat(db): add ai_sessions + agents tables, blended_hourly_rate_zar setting"
```

---

## Task 2: Shared Pure Logic + Tests

**Files:**
- Create: `supabase/functions/_shared/output-multiplier-logic.ts`
- Create: `supabase/functions/_shared/output-multiplier-logic.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// supabase/functions/_shared/output-multiplier-logic.test.ts
import { describe, it, expect } from "vitest";
import { periodRange, computeMultiplier } from "./output-multiplier-logic.ts";

describe("periodRange", () => {
  it("returns correct month range", () => {
    const r = periodRange("month", "2026-05-12");
    expect(r.startDate).toBe("2026-05-01");
    expect(r.endDate).toBe("2026-06-01");
    expect(r.label).toBe("May 2026");
  });

  it("returns correct week range — Mon to Sun", () => {
    // 2026-05-12 is a Tuesday
    const r = periodRange("week", "2026-05-12");
    expect(r.startDate).toBe("2026-05-11"); // Monday
    expect(r.endDate).toBe("2026-05-18");   // following Monday (exclusive)
    expect(r.label).toMatch(/W\d+ 2026/);
  });

  it("returns correct year range", () => {
    const r = periodRange("year", "2026-05-12");
    expect(r.startDate).toBe("2026-01-01");
    expect(r.endDate).toBe("2027-01-01");
    expect(r.label).toBe("2026");
  });
});

describe("computeMultiplier", () => {
  it("returns (human + ai) / human", () => {
    expect(computeMultiplier(2, 18)).toBe(10);
  });

  it("caps at 20", () => {
    expect(computeMultiplier(0.1, 100)).toBe(20);
  });

  it("returns 1 when human hours is 0", () => {
    expect(computeMultiplier(0, 10)).toBe(1);
  });

  it("returns 1 when no AI hours", () => {
    expect(computeMultiplier(5, 0)).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run supabase/functions/_shared/output-multiplier-logic.test.ts
```

Expected: FAIL — `Cannot find module './output-multiplier-logic.ts'`

- [ ] **Step 3: Implement the logic**

```typescript
// supabase/functions/_shared/output-multiplier-logic.ts

export type Period = "year" | "month" | "week";

export interface PeriodRange {
  startDate: string; // ISO date, inclusive
  endDate: string;   // ISO date, exclusive
  label: string;
}

/** ISO date string from a Date */
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO week number (1–53) */
function isoWeek(d: Date): number {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d.getTime() - startOfWeek1.getTime();
  return Math.floor(diff / (7 * 86400000)) + 1;
}

export function periodRange(view: Period, date: string): PeriodRange {
  const d = new Date(date);

  if (view === "year") {
    const y = d.getFullYear();
    return {
      startDate: `${y}-01-01`,
      endDate: `${y + 1}-01-01`,
      label: String(y),
    };
  }

  if (view === "month") {
    const y = d.getFullYear();
    const m = d.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    const label = start.toLocaleString("en-ZA", { month: "long", year: "numeric" });
    return { startDate: toIso(start), endDate: toIso(end), label };
  }

  // week: Mon–Sun ISO week
  const day = d.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  const nextMon = new Date(mon);
  nextMon.setDate(mon.getDate() + 7);
  const week = isoWeek(mon);
  return {
    startDate: toIso(mon),
    endDate: toIso(nextMon),
    label: `W${week} ${mon.getFullYear()}`,
  };
}

/**
 * Output multiplier: total effective output per human hour invested.
 * Formula: (human_hours + ai_session_hours) / human_hours, capped at 20×.
 */
export function computeMultiplier(humanHours: number, aiSessionHours: number): number {
  if (humanHours <= 0) return 1;
  const raw = (humanHours + aiSessionHours) / humanHours;
  return Math.min(raw, 20);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run supabase/functions/_shared/output-multiplier-logic.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/output-multiplier-logic.ts \
        supabase/functions/_shared/output-multiplier-logic.test.ts
git commit -m "feat(shared): add periodRange and computeMultiplier pure logic"
```

---

## Task 3: Edge Function — `log-ai-session`

**Files:**
- Create: `supabase/functions/log-ai-session/index.ts`

This function receives a logged session from the `/log` skill, writes a row to `ai_sessions`, and optionally patches ClickUp task custom fields.

- [ ] **Step 1: Write the edge function**

```typescript
// supabase/functions/log-ai-session/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

interface RequestBody {
  logged_by: string;
  session_date: string;           // ISO date e.g. "2026-05-12"
  clickup_task_id?: string;
  project_slug?: string;
  ai_input_tokens: number;
  ai_output_tokens: number;
  ai_duration_minutes: number;
  ai_cost_zar: number;
  human_minutes: number;
  concurrent_sessions: number;
  engagement_type: "task" | "agent-run";
  agent_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (!body.logged_by || !body.session_date) {
    return json({ error: "logged_by and session_date are required" }, 400);
  }

  const sb = createServiceRoleClient();

  // Write to ai_sessions
  const { data: session, error: insertErr } = await sb
    .from("ai_sessions")
    .insert({
      logged_by: body.logged_by,
      session_date: body.session_date,
      clickup_task_id: body.clickup_task_id ?? null,
      project_slug: body.project_slug ?? null,
      ai_input_tokens: body.ai_input_tokens,
      ai_output_tokens: body.ai_output_tokens,
      ai_duration_minutes: body.ai_duration_minutes,
      ai_cost_zar: body.ai_cost_zar,
      human_minutes: body.human_minutes,
      concurrent_sessions: body.concurrent_sessions,
      engagement_type: body.engagement_type,
      agent_id: body.agent_id ?? null,
    })
    .select("id")
    .single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  // Optionally patch ClickUp task custom fields
  if (body.clickup_task_id) {
    const pat = Deno.env.get("CLICKUP_PAT");
    if (pat) {
      await patchClickUpAiFields(pat, body.clickup_task_id, {
        ai_input_tokens: body.ai_input_tokens,
        ai_output_tokens: body.ai_output_tokens,
        ai_cost_zar: body.ai_cost_zar,
        ai_duration_minutes: body.ai_duration_minutes,
      });
    }
  }

  return json({ id: session.id });
});

interface AiFields {
  ai_input_tokens: number;
  ai_output_tokens: number;
  ai_cost_zar: number;
  ai_duration_minutes: number;
}

async function patchClickUpAiFields(pat: string, taskId: string, fields: AiFields) {
  // Fetch the task to discover its custom field IDs
  const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    headers: { Authorization: pat },
  });
  if (!taskRes.ok) return;

  const task = await taskRes.json();
  const cuFields: Array<{ id: string; name: string; value: unknown }> =
    task.custom_fields ?? [];

  const fieldMap: Record<string, number> = {
    ai_input_tokens: fields.ai_input_tokens,
    ai_output_tokens: fields.ai_output_tokens,
    ai_cost_zar: fields.ai_cost_zar,
    ai_duration_minutes: fields.ai_duration_minutes,
  };

  await Promise.all(
    Object.entries(fieldMap).map(async ([name, value]) => {
      const cuField = cuFields.find(
        (f) => f.name.toLowerCase().replace(/\s+/g, "_") === name,
      );
      if (!cuField) return;
      await fetch(
        `https://api.clickup.com/api/v2/task/${taskId}/field/${cuField.id}`,
        {
          method: "POST",
          headers: {
            Authorization: pat,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value }),
        },
      );
    }),
  );
}
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy log-ai-session \
  --project-ref lpgwxacoqiqpcfpkklib \
  --no-verify-jwt
```

Expected: `Deployed Function log-ai-session`

- [ ] **Step 3: Smoke test — write a session row**

```bash
curl -s -X POST \
  "$(npx supabase functions url log-ai-session --project-ref lpgwxacoqiqpcfpkklib)" \
  -H "Content-Type: application/json" \
  -d '{
    "logged_by": "brendan@convertedclick.co.za",
    "session_date": "2026-05-12",
    "project_slug": "cc-service-calculator",
    "ai_input_tokens": 50000,
    "ai_output_tokens": 10000,
    "ai_duration_minutes": 45,
    "ai_cost_zar": 12.50,
    "human_minutes": 30,
    "concurrent_sessions": 1,
    "engagement_type": "task"
  }'
```

Expected: `{"id":"<uuid>"}`. Verify the row appears in `ai_sessions` in the Supabase dashboard.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/log-ai-session/index.ts
git commit -m "feat(edge): add log-ai-session edge function"
```

---

## Task 4: Edge Function — `get-output-multiplier`

**Files:**
- Create: `supabase/functions/get-output-multiplier/index.ts`

One function handles all three views, branching on `body.view`.

- [ ] **Step 1: Write the edge function**

```typescript
// supabase/functions/get-output-multiplier/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { periodRange, computeMultiplier } from "../_shared/output-multiplier-logic.ts";

type ViewType = "direct" | "parallel" | "passive";
type PeriodType = "year" | "month" | "week";

interface RequestBody {
  view: ViewType;
  period: PeriodType;
  date: string;
  logged_by?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { view, period, date, logged_by } = body;
  if (!view || !period || !date) {
    return json({ error: "view, period, and date are required" }, 400);
  }

  const pr = periodRange(period, date);
  const sb = createServiceRoleClient();

  if (view === "direct") return directView(sb, pr, logged_by);
  if (view === "parallel") return parallelView(sb, pr, logged_by);
  if (view === "passive") return passiveView(sb, pr, logged_by);

  return json({ error: `unknown view: ${view}` }, 400);
});

// ─── Direct view ────────────────────────────────────────────────────────────

async function directView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  logged_by?: string,
) {
  const { data, error } = await sb.rpc("get_direct_multiplier", {
    p_start: pr.startDate,
    p_end: pr.endDate,
    p_logged_by: logged_by ?? null,
  });
  if (error) return json({ error: error.message }, 500);

  // data rows: { logged_by, display_name, human_hours, ai_session_hours, ai_cost_zar }
  const members = (data as Array<{
    logged_by: string;
    display_name: string;
    human_hours: number;
    ai_session_hours: number;
    ai_cost_zar: number;
  }>).map((row) => {
    const multiplier = computeMultiplier(row.human_hours, row.ai_session_hours);
    return {
      email: row.logged_by,
      display_name: row.display_name,
      human_hours: row.human_hours,
      ai_session_hours: row.ai_session_hours,
      ai_cost_zar: row.ai_cost_zar,
      multiplier,
      effective_output_hours: row.human_hours * multiplier,
    };
  });

  const avgMultiplier =
    members.length > 0
      ? members.reduce((s, m) => s + m.multiplier, 0) / members.length
      : 0;

  return json({
    periodLabel: pr.label,
    members,
    totals: {
      avg_multiplier: Math.round(avgMultiplier * 10) / 10,
      total_human_hours: members.reduce((s, m) => s + m.human_hours, 0),
      total_ai_hours: members.reduce((s, m) => s + m.ai_session_hours, 0),
      total_cost_zar: members.reduce((s, m) => s + m.ai_cost_zar, 0),
    },
  });
}

// ─── Parallel view ───────────────────────────────────────────────────────────

async function parallelView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  logged_by?: string,
) {
  let query = sb
    .from("ai_sessions")
    .select("session_date, concurrent_sessions, project_slug, ai_duration_minutes, logged_by")
    .gte("session_date", pr.startDate)
    .lt("session_date", pr.endDate)
    .eq("engagement_type", "task")
    .order("session_date");

  if (logged_by) query = query.eq("logged_by", logged_by);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Group by date
  const byDate = new Map<string, {
    sessions: Array<{ slot: number; project_slug: string; duration_minutes: number }>;
    concurrent_count: number;
  }>();

  for (const row of data ?? []) {
    const key = row.session_date as string;
    if (!byDate.has(key)) byDate.set(key, { sessions: [], concurrent_count: 0 });
    const entry = byDate.get(key)!;
    const slot = entry.sessions.length + 1;
    entry.sessions.push({
      slot,
      project_slug: (row.project_slug as string) ?? "unknown",
      duration_minutes: Number(row.ai_duration_minutes),
    });
    entry.concurrent_count = Math.max(
      entry.concurrent_count,
      row.concurrent_sessions as number,
    );
  }

  const days = Array.from(byDate.entries()).map(([date, val]) => {
    const wallClock = val.sessions.reduce((s, r) => s + r.duration_minutes, 0) /
      Math.max(val.concurrent_count, 1);
    return {
      date,
      sessions: val.sessions,
      concurrent_count: val.concurrent_count,
      parallel_multiplier:
        Math.round((val.sessions.reduce((s, r) => s + r.duration_minutes, 0) /
          Math.max(wallClock, 1)) * 10) / 10,
    };
  });

  const totalParallelHours = days.reduce(
    (s, d) => s + d.sessions.reduce((ss, r) => ss + r.duration_minutes, 0) / 60,
    0,
  );
  const peakConcurrent = days.reduce((s, d) => Math.max(s, d.concurrent_count), 0);
  const avgConcurrent =
    days.length > 0
      ? days.reduce((s, d) => s + d.concurrent_count, 0) / days.length
      : 0;

  return json({
    periodLabel: pr.label,
    days,
    summary: {
      avg_concurrent: Math.round(avgConcurrent * 10) / 10,
      peak_concurrent: peakConcurrent,
      parallel_output_hours: Math.round(totalParallelHours * 10) / 10,
      wall_clock_hours: Math.round((totalParallelHours / Math.max(avgConcurrent, 1)) * 10) / 10,
    },
  });
}

// ─── Passive view ────────────────────────────────────────────────────────────

async function passiveView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  logged_by?: string,
) {
  // Get blended rate from settings
  const { data: settingsData } = await sb
    .from("settings")
    .select("blended_hourly_rate_zar")
    .eq("id", 1)
    .single();
  const blendedRate = (settingsData?.blended_hourly_rate_zar as number) ?? 350;

  let query = sb
    .from("ai_sessions")
    .select("agent_id, agents(name, description, estimated_human_hours_per_run, creator)")
    .eq("engagement_type", "agent-run")
    .gte("session_date", pr.startDate)
    .lt("session_date", pr.endDate)
    .not("agent_id", "is", null);

  if (logged_by) {
    // Filter by creator via the joined agents table
    query = query.eq("agents.creator", logged_by);
  }

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Aggregate by agent_id
  const byAgent = new Map<string, {
    name: string;
    description: string;
    estimated_human_hours_per_run: number;
    runs: number;
  }>();

  for (const row of data ?? []) {
    const agent = row.agents as {
      name: string;
      description: string;
      estimated_human_hours_per_run: number;
      creator: string;
    } | null;
    if (!agent) continue;
    // If filtering by logged_by, skip agents from other creators
    if (logged_by && agent.creator !== logged_by) continue;

    const key = row.agent_id as string;
    if (!byAgent.has(key)) {
      byAgent.set(key, {
        name: agent.name,
        description: agent.description,
        estimated_human_hours_per_run: agent.estimated_human_hours_per_run,
        runs: 0,
      });
    }
    byAgent.get(key)!.runs++;
  }

  const agents = Array.from(byAgent.entries()).map(([id, val]) => {
    const estimated_human_hours = val.runs * val.estimated_human_hours_per_run;
    return {
      id,
      name: val.name,
      description: val.description,
      runs: val.runs,
      estimated_human_hours: Math.round(estimated_human_hours * 10) / 10,
      blended_cost_zar: Math.round(estimated_human_hours * blendedRate),
    };
  }).sort((a, b) => b.estimated_human_hours - a.estimated_human_hours);

  const totals = {
    total_runs: agents.reduce((s, a) => s + a.runs, 0),
    total_passive_hours: agents.reduce((s, a) => s + a.estimated_human_hours, 0),
    total_cost_zar: agents.reduce((s, a) => s + a.blended_cost_zar, 0),
  };

  return json({ periodLabel: pr.label, agents, totals });
}
```

- [ ] **Step 2: Add the `get_direct_multiplier` SQL function** (needed by the Direct view's `sb.rpc()` call)

Add to a new migration `supabase/migrations/0039_direct_multiplier_fn.sql`:

```sql
-- supabase/migrations/0039_direct_multiplier_fn.sql
create or replace function get_direct_multiplier(
  p_start date,
  p_end   date,
  p_logged_by text default null
)
returns table (
  logged_by        text,
  display_name     text,
  human_hours      numeric,
  ai_session_hours numeric,
  ai_cost_zar      numeric
)
language sql
security definer
as $$
  select
    s.logged_by,
    coalesce(tm.full_name, s.logged_by) as display_name,
    round(sum(s.human_minutes) / 60.0, 2)          as human_hours,
    round(sum(s.ai_duration_minutes) / 60.0, 2)    as ai_session_hours,
    round(sum(s.ai_cost_zar), 2)                   as ai_cost_zar
  from ai_sessions s
  left join team_members tm on tm.email = s.logged_by
  where s.session_date >= p_start
    and s.session_date < p_end
    and s.engagement_type = 'task'
    and (p_logged_by is null or s.logged_by = p_logged_by)
  group by s.logged_by, tm.full_name
  order by ai_session_hours desc
$$;
```

Apply it:
```bash
npx supabase db push --project-ref lpgwxacoqiqpcfpkklib
```

- [ ] **Step 3: Deploy get-output-multiplier**

```bash
npx supabase functions deploy get-output-multiplier \
  --project-ref lpgwxacoqiqpcfpkklib \
  --no-verify-jwt
```

Expected: `Deployed Function get-output-multiplier`

- [ ] **Step 4: Smoke test — Direct view**

```bash
curl -s -X POST \
  "$(npx supabase functions url get-output-multiplier --project-ref lpgwxacoqiqpcfpkklib)" \
  -H "Content-Type: application/json" \
  -d '{"view":"direct","period":"month","date":"2026-05-12"}'
```

Expected: `{"periodLabel":"May 2026","members":[...],"totals":{...}}` (members may be empty if no sessions logged yet — that's fine).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/get-output-multiplier/index.ts \
        supabase/migrations/0039_direct_multiplier_fn.sql
git commit -m "feat(edge): add get-output-multiplier edge function (Direct/Parallel/Passive)"
```

---

## Task 5: `useOutputMultiplier` Hook + Tests

**Files:**
- Create: `src/hooks/useOutputMultiplier.ts`
- Create: `src/hooks/useOutputMultiplier.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/hooks/useOutputMultiplier.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { computeBubbleRadii, computeMultiplierFrontend } from "./useOutputMultiplier";

describe("computeMultiplierFrontend", () => {
  it("returns (human + ai) / human", () => {
    expect(computeMultiplierFrontend(2, 18)).toBe(10);
  });
  it("caps at 20", () => {
    expect(computeMultiplierFrontend(0.1, 100)).toBe(20);
  });
  it("returns 1 when human is 0", () => {
    expect(computeMultiplierFrontend(0, 5)).toBe(1);
  });
});

describe("computeBubbleRadii", () => {
  it("inner radius grows with human hours", () => {
    const small = computeBubbleRadii(1, 5, 2);
    const large = computeBubbleRadii(9, 5, 2);
    expect(large.innerR).toBeGreaterThan(small.innerR);
  });

  it("middle radius is always larger than inner", () => {
    const r = computeBubbleRadii(2, 18, 8);
    expect(r.middleR).toBeGreaterThan(r.innerR);
  });

  it("outer radius is capped at 90", () => {
    const r = computeBubbleRadii(0.1, 100, 20);
    expect(r.outerR).toBeLessThanOrEqual(90);
  });

  it("outer radius equals innerR when multiplier is 1", () => {
    const r = computeBubbleRadii(5, 0, 1);
    expect(r.outerR).toBe(r.innerR);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/hooks/useOutputMultiplier.test.ts
```

Expected: FAIL — `Cannot find module './useOutputMultiplier'`

- [ ] **Step 3: Implement the hook and pure functions**

```typescript
// src/hooks/useOutputMultiplier.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type MultiplierView = "direct" | "parallel" | "passive";
export type MultiplierPeriod = "year" | "month" | "week";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DirectMember {
  email: string;
  display_name: string;
  human_hours: number;
  ai_session_hours: number;
  ai_cost_zar: number;
  multiplier: number;
  effective_output_hours: number;
}

export interface DirectData {
  periodLabel: string;
  members: DirectMember[];
  totals: {
    avg_multiplier: number;
    total_human_hours: number;
    total_ai_hours: number;
    total_cost_zar: number;
  };
}

export interface ParallelSession {
  slot: number;
  project_slug: string;
  duration_minutes: number;
}

export interface ParallelDay {
  date: string;
  sessions: ParallelSession[];
  concurrent_count: number;
  parallel_multiplier: number;
}

export interface ParallelData {
  periodLabel: string;
  days: ParallelDay[];
  summary: {
    avg_concurrent: number;
    peak_concurrent: number;
    parallel_output_hours: number;
    wall_clock_hours: number;
  };
}

export interface PassiveAgent {
  id: string;
  name: string;
  description: string;
  runs: number;
  estimated_human_hours: number;
  blended_cost_zar: number;
}

export interface PassiveData {
  periodLabel: string;
  agents: PassiveAgent[];
  totals: {
    total_runs: number;
    total_passive_hours: number;
    total_cost_zar: number;
  };
}

export type OutputMultiplierData = DirectData | ParallelData | PassiveData;

// ─── Pure functions (exported for testing) ───────────────────────────────────

export function computeMultiplierFrontend(humanHours: number, aiHours: number): number {
  if (humanHours <= 0) return 1;
  return Math.min((humanHours + aiHours) / humanHours, 20);
}

export interface BubbleRadii {
  innerR: number;
  middleR: number;
  outerR: number;
}

export function computeBubbleRadii(
  humanHours: number,
  aiHours: number,
  multiplier: number,
): BubbleRadii {
  const BASE = 20;
  const MAX = 90;
  const innerR = BASE + Math.sqrt(Math.max(humanHours, 0)) * 8;
  const middleR = innerR + Math.sqrt(Math.max(aiHours, 0)) * 6;
  const outerR = Math.min(innerR * multiplier, MAX);
  return { innerR, middleR, outerR };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOutputMultiplier(
  view: MultiplierView,
  period: MultiplierPeriod,
  date: string,
  loggedBy?: string,
) {
  return useQuery<OutputMultiplierData>({
    queryKey: ["output-multiplier", view, period, date, loggedBy ?? "team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-output-multiplier", {
        body: { view, period, date, logged_by: loggedBy },
      });
      if (error) throw error;
      return data as OutputMultiplierData;
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/hooks/useOutputMultiplier.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOutputMultiplier.ts src/hooks/useOutputMultiplier.test.ts
git commit -m "feat(hook): add useOutputMultiplier with computeBubbleRadii + computeMultiplierFrontend"
```

---

## Task 6: `DirectView` — Concentric Ring Bubble Chart

**Files:**
- Create: `src/components/productivity/DirectView.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/DirectView.tsx
import { DirectData, computeBubbleRadii } from "@/hooks/useOutputMultiplier";
import { formatCurrency } from "@/lib/format";

const MEMBER_COLORS = [
  "#7C3AED", "#EC4899", "#0891B2", "#059669", "#D97706", "#E11D48", "#4F46E5",
];

interface Props {
  data: DirectData;
}

export function DirectView({ data }: Props) {
  const { members, totals, periodLabel } = data;

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-4 gap-3">
        <Chip label="Avg Multiplier" value={`${totals.avg_multiplier}×`} sub={periodLabel} />
        <Chip
          label="Human Hours"
          value={`${totals.total_human_hours.toFixed(1)}h`}
          sub="invested"
        />
        <Chip
          label="AI Session Hours"
          value={`${totals.total_ai_hours.toFixed(1)}h`}
          sub="across sessions"
        />
        <Chip
          label="AI Cost"
          value={formatCurrency(totals.total_cost_zar)}
          sub={
            totals.total_ai_hours > 0
              ? `${formatCurrency(totals.total_cost_zar / totals.total_ai_hours)}/hr`
              : "—"
          }
        />
      </div>

      {/* Bubble chart */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
          Output Expansion — by person
        </p>
        <p className="text-body-small text-m-on-surface-variant/60 mb-6">
          Inner circle = human hours · Middle ring = AI session hours · Outer ring = effective
          output (human × multiplier)
        </p>

        {members.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant/40 text-center py-12">
            No sessions logged for this period. Use /log to record your first session.
          </p>
        ) : (
          <div className="flex flex-wrap gap-8 justify-around items-center py-4">
            {members.map((member, idx) => {
              const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];
              const { innerR, middleR, outerR } = computeBubbleRadii(
                member.human_hours,
                member.ai_session_hours,
                member.multiplier,
              );
              const size = 200;
              const cx = size / 2;
              const cy = size / 2;

              return (
                <div key={member.email} className="flex flex-col items-center gap-3">
                  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    {/* Outer ring: effective output */}
                    <circle
                      cx={cx} cy={cy} r={outerR}
                      fill={`${color}12`}
                      stroke={`${color}33`}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                    {/* Middle ring: AI session hours */}
                    <circle
                      cx={cx} cy={cy} r={middleR}
                      fill={`${color}1f`}
                      stroke={`${color}4d`}
                      strokeWidth={1}
                    />
                    {/* Inner circle: human hours */}
                    <circle
                      cx={cx} cy={cy} r={innerR}
                      fill={`${color}b3`}
                      stroke={color}
                      strokeWidth={2}
                    />
                    {/* Multiplier label */}
                    <text
                      x={cx} y={cy - 4}
                      textAnchor="middle"
                      fill={color}
                      fontSize={16}
                      fontWeight={800}
                      fontFamily="Inter, sans-serif"
                    >
                      {member.multiplier.toFixed(1)}×
                    </text>
                    <text
                      x={cx} y={cy + 13}
                      textAnchor="middle"
                      fill={`${color}99`}
                      fontSize={9}
                      fontFamily="Inter, sans-serif"
                    >
                      multiplier
                    </text>
                  </svg>
                  <p className="text-label-large text-m-on-surface">{member.display_name}</p>
                  <p className="text-body-small text-m-on-surface-variant">
                    {member.human_hours.toFixed(1)}h human ·{" "}
                    {member.ai_session_hours.toFixed(1)}h AI
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex gap-5 mt-5 pt-4 border-t border-m-outline-variant">
          <LegendItem color="#7C3AED" opacity="solid" label="Human hours" />
          <LegendItem color="#7C3AED" opacity="medium" label="AI session hours" />
          <LegendItem color="#7C3AED" opacity="faint" label="Effective output" dashed />
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, sub }: { label: string; value: string; sub: string }) {
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

function LegendItem({
  color,
  opacity,
  label,
  dashed,
}: {
  color: string;
  opacity: "solid" | "medium" | "faint";
  label: string;
  dashed?: boolean;
}) {
  const fill =
    opacity === "solid" ? `${color}b3` : opacity === "medium" ? `${color}2f` : `${color}12`;
  return (
    <div className="flex items-center gap-2 text-body-small text-m-on-surface-variant">
      <svg width={12} height={12}>
        <circle
          cx={6} cy={6} r={5}
          fill={fill}
          stroke={`${color}4d`}
          strokeWidth={1}
          strokeDasharray={dashed ? "3 2" : undefined}
        />
      </svg>
      {label}
    </div>
  );
}
```

- [ ] **Step 2: Check `formatCurrency` exists**

```bash
grep -r "export function formatCurrency\|export const formatCurrency" src/lib/
```

If it doesn't exist, add it to `src/lib/format.ts` (create the file if needed):

```typescript
// src/lib/format.ts
export function formatCurrency(zar: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(zar);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/productivity/DirectView.tsx src/lib/format.ts
git commit -m "feat(ui): add DirectView concentric ring bubble chart"
```

---

## Task 7: `ParallelView` — Session Concurrency Grid

**Files:**
- Create: `src/components/productivity/ParallelView.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/ParallelView.tsx
import { ParallelData, ParallelSession } from "@/hooks/useOutputMultiplier";

const PROJECT_COLORS: Record<string, string> = {
  "cc-service-calculator": "bg-violet-900/40 border-violet-600/40 text-violet-300",
  granite: "bg-cyan-900/40 border-cyan-600/40 text-cyan-300",
  pebble: "bg-emerald-900/40 border-emerald-600/40 text-emerald-300",
  intake: "bg-amber-900/40 border-amber-600/40 text-amber-300",
};

const DEFAULT_COLOR = "bg-slate-800/60 border-slate-600/40 text-slate-300";

function sessionColor(slug: string): string {
  return PROJECT_COLORS[slug] ?? DEFAULT_COLOR;
}

const MAX_SLOTS = 6;

interface Props {
  data: ParallelData;
}

export function ParallelView({ data }: Props) {
  const { days, summary, periodLabel } = data;

  // Determine max slots across all days for grid rows
  const maxSlots = Math.min(
    Math.max(...days.map((d) => d.sessions.length), 1),
    MAX_SLOTS,
  );

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3">
        <Chip
          label="Avg Concurrent Sessions"
          value={`${summary.avg_concurrent}×`}
          sub={periodLabel}
        />
        <Chip
          label="Peak Sessions"
          value={String(summary.peak_concurrent)}
          sub="in one wall-clock period"
        />
        <Chip
          label="Parallel Output Hours"
          value={`${summary.parallel_output_hours}h`}
          sub={`from ${summary.wall_clock_hours}h wall-clock`}
        />
      </div>

      {/* Concurrency grid */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
          Session concurrency — {periodLabel}
        </p>
        <p className="text-body-small text-m-on-surface-variant/60 mb-5">
          Each column = one day. Rows = simultaneous Claude sessions. More filled rows = higher
          parallel multiplier.
        </p>

        {days.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant/40 text-center py-12">
            No sessions logged for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `80px repeat(${days.length}, minmax(80px, 1fr))`,
                gridTemplateRows: `auto ${Array.from({ length: maxSlots }, () => "36px").join(" ")}`,
              }}
            >
              {/* Column headers */}
              <div />
              {days.map((day) => (
                <div
                  key={day.date}
                  className="text-label-small text-m-on-surface-variant text-center pb-1.5"
                >
                  {new Date(day.date).toLocaleDateString("en-ZA", {
                    weekday: "short",
                    day: "numeric",
                  })}
                </div>
              ))}

              {/* Session rows */}
              {Array.from({ length: maxSlots }, (_, slotIdx) => (
                <>
                  <div
                    key={`label-${slotIdx}`}
                    className="text-body-small text-m-on-surface-variant/60 flex items-center"
                  >
                    Session {slotIdx + 1}
                  </div>
                  {days.map((day) => {
                    const session: ParallelSession | undefined = day.sessions[slotIdx];
                    return (
                      <div
                        key={`${day.date}-${slotIdx}`}
                        className={[
                          "rounded-md border flex items-center justify-center text-[10px] font-semibold h-9",
                          session
                            ? sessionColor(session.project_slug)
                            : "bg-m-surface-container-high border-m-outline-variant/30",
                        ].join(" ")}
                        title={
                          session
                            ? `${session.project_slug} — ${Math.round(session.duration_minutes)}min`
                            : undefined
                        }
                      >
                        {session
                          ? session.project_slug.split("-")[0].slice(0, 6)
                          : ""}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        )}

        {days.length > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-m-primary/30 bg-m-primary/10 px-3 py-1.5 text-body-small text-m-primary font-semibold">
            ⚡ Period avg: {summary.avg_concurrent}× parallel — equivalent to{" "}
            {summary.avg_concurrent}× people working simultaneously
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value, sub }: { label: string; value: string; sub: string }) {
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

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/ParallelView.tsx
git commit -m "feat(ui): add ParallelView session concurrency grid"
```

---

## Task 8: `PassiveView` — Agent Leaderboard

**Files:**
- Create: `src/components/productivity/PassiveView.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/PassiveView.tsx
import { PassiveData } from "@/hooks/useOutputMultiplier";
import { formatCurrency } from "@/lib/format";

const AGENT_ICONS: Record<string, string> = {
  "skill-intake": "📥",
  "skill-log": "📋",
  "skill-brief": "📝",
  "skill-scheduler": "📊",
  "skill-sow": "📄",
};

interface Props {
  data: PassiveData;
}

export function PassiveView({ data }: Props) {
  const { agents, totals, periodLabel } = data;
  const maxHours = Math.max(...agents.map((a) => a.estimated_human_hours), 1);

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3">
        <Chip
          label="Agents Built"
          value={String(new Set(agents.map((a) => a.id)).size)}
          sub="by this person"
        />
        <Chip
          label="Total Passive Hours"
          value={`${totals.total_passive_hours.toFixed(1)}h`}
          sub={periodLabel}
        />
        <Chip
          label="Equiv. Human Cost"
          value={formatCurrency(totals.total_cost_zar)}
          sub="at blended rate"
        />
      </div>

      {/* Agent leaderboard */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
          Agent output — {periodLabel}
        </p>
        <p className="text-body-small text-m-on-surface-variant/60 mb-5">
          Equivalent human hours delivered by each agent you built. Logged via /log with
          engagement type "Agent Run".
        </p>

        {agents.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant/40 text-center py-12">
            No agent runs logged for this period. Use /log with "Agent Run" type.
          </p>
        ) : (
          <div className="space-y-0 divide-y divide-m-outline-variant/30">
            {agents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 py-3">
                <div className="w-9 h-9 rounded-lg border border-m-primary/25 bg-m-primary/10 flex items-center justify-center text-base flex-shrink-0">
                  {AGENT_ICONS[agent.id] ?? "🤖"}
                </div>
                <div className="min-w-0">
                  <p className="text-label-large text-m-on-surface">{agent.name}</p>
                  <p className="text-body-small text-m-on-surface-variant/60 truncate">
                    {agent.description}
                  </p>
                </div>
                {/* Progress bar */}
                <div className="flex-1 mx-3 h-1.5 rounded-full bg-m-surface-container-high overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-m-primary to-m-primary/70"
                    style={{ width: `${(agent.estimated_human_hours / maxHours) * 100}%` }}
                  />
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-label-large text-m-on-surface">{agent.runs} runs</p>
                  <p className="text-body-small text-m-primary">
                    {agent.estimated_human_hours.toFixed(1)}h equiv.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Total row */}
        {agents.length > 0 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-m-outline-variant">
            <div>
              <p className="text-body-small text-m-on-surface-variant">
                Total passive leverage this {periodLabel.toLowerCase()}
              </p>
              <p className="text-body-small text-m-on-surface-variant/50">
                Equivalent human work produced by IP you built
              </p>
            </div>
            <p className="text-headline-small text-m-primary font-extrabold">
              {totals.total_passive_hours.toFixed(0)}h ·{" "}
              {formatCurrency(totals.total_cost_zar)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value, sub }: { label: string; value: string; sub: string }) {
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

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/PassiveView.tsx
git commit -m "feat(ui): add PassiveView agent leaderboard"
```

---

## Task 9: `OutputMultiplierShell` — Sub-Tab Switcher + Period Nav

**Files:**
- Create: `src/components/productivity/OutputMultiplierShell.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/productivity/OutputMultiplierShell.tsx
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DirectView } from "./DirectView";
import { ParallelView } from "./ParallelView";
import { PassiveView } from "./PassiveView";
import {
  useOutputMultiplier,
  MultiplierView,
  MultiplierPeriod,
} from "@/hooks/useOutputMultiplier";

interface Props {
  loggedBy?: string; // undefined = whole team
}

const VIEWS: { key: MultiplierView; label: string }[] = [
  { key: "direct", label: "Direct" },
  { key: "parallel", label: "Parallel" },
  { key: "passive", label: "Passive" },
];

const PERIODS: MultiplierPeriod[] = ["week", "month", "year"];

function anchorDate(period: MultiplierPeriod, offset: number): string {
  const d = new Date();
  if (period === "week") d.setDate(d.getDate() + offset * 7);
  if (period === "month") d.setMonth(d.getMonth() + offset);
  if (period === "year") d.setFullYear(d.getFullYear() + offset);
  return d.toISOString().slice(0, 10);
}

export function OutputMultiplierShell({ loggedBy }: Props) {
  const [view, setView] = useState<MultiplierView>("direct");
  const [period, setPeriod] = useState<MultiplierPeriod>("month");
  const [periodOffset, setPeriodOffset] = useState(0);

  const date = anchorDate(period, periodOffset);
  const { data, isLoading, isError } = useOutputMultiplier(view, period, date, loggedBy);

  return (
    <div className="space-y-5">
      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* View sub-tabs */}
        <div className="flex gap-1 rounded-lg border border-m-outline-variant bg-m-surface-container p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={[
                "rounded-md px-4 py-1.5 text-label-medium transition-colors",
                view === v.key
                  ? "bg-m-primary/15 text-m-primary"
                  : "text-m-on-surface-variant hover:text-m-on-surface",
              ].join(" ")}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Period selector + prev/next */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-m-outline-variant bg-m-surface-container p-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setPeriodOffset(0); }}
                className={[
                  "rounded-md px-3 py-1.5 text-label-small capitalize transition-colors",
                  period === p
                    ? "bg-m-primary/15 text-m-primary"
                    : "text-m-on-surface-variant hover:text-m-on-surface",
                ].join(" ")}
              >
                {p}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPeriodOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPeriodOffset((o) => Math.min(o + 1, 0))}
            disabled={periodOffset === 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="text-m-on-surface-variant text-body-medium">Loading…</div>
        </div>
      )}
      {isError && (
        <div className="rounded-xl border border-m-error/30 bg-m-error/10 p-6 text-m-error text-body-medium">
          Failed to load output multiplier data.
        </div>
      )}
      {data && !isLoading && (
        <>
          {view === "direct" && "members" in data && <DirectView data={data} />}
          {view === "parallel" && "days" in data && <ParallelView data={data} />}
          {view === "passive" && "agents" in data && <PassiveView data={data} />}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/productivity/OutputMultiplierShell.tsx
git commit -m "feat(ui): add OutputMultiplierShell with sub-tab + period nav"
```

---

## Task 10: Wire into `ProductivityPage`

**Files:**
- Modify: `src/pages/ProductivityPage.tsx`

- [ ] **Step 1: Read the current ProductivityPage**

Open `src/pages/ProductivityPage.tsx` and find where the page title / tab controls are rendered.

- [ ] **Step 2: Add `pageTab` state and top-level tab switcher**

Add these imports at the top:
```tsx
import { OutputMultiplierShell } from "@/components/productivity/OutputMultiplierShell";
```

Add state after existing state declarations:
```tsx
const [pageTab, setPageTab] = useState<"sprint" | "multiplier">("sprint");
```

Wrap the existing page content to be conditional on `pageTab === "sprint"`. Before the existing header row or title, insert the page-level tab switcher:

```tsx
{/* Page tab switcher */}
<div className="flex gap-0 border-b border-m-outline-variant mb-6 -mx-6 px-6">
  {(["sprint", "multiplier"] as const).map((tab) => (
    <button
      key={tab}
      onClick={() => setPageTab(tab)}
      className={[
        "px-5 py-3.5 text-label-medium border-b-2 -mb-px transition-colors",
        pageTab === tab
          ? "text-m-primary border-m-primary"
          : "text-m-on-surface-variant border-transparent hover:text-m-on-surface",
      ].join(" ")}
    >
      {tab === "sprint" ? "Sprint Output" : "Output Multiplier"}
    </button>
  ))}
</div>
```

Replace the existing content block so it conditionally renders:
```tsx
{pageTab === "sprint" ? (
  {/* EXISTING sprint content — SprintPointsChart, HoursTrackedChart, etc. */}
) : (
  <OutputMultiplierShell loggedBy={selectedClickupUserId ? selectedMemberEmail : undefined} />
)}
```

> **Note on `selectedMemberEmail`:** the existing page likely tracks the selected team member by ClickUp user ID. You'll need to resolve the email from the `useTeam()` data to pass to `OutputMultiplierShell`. Add a derived value:
> ```tsx
> const selectedMemberEmail = selectedClickupUserId
>   ? team?.find((m) => m.clickup_user_id === selectedClickupUserId)?.email
>   : undefined;
> ```

- [ ] **Step 3: Run the dev server and verify both tabs render**

```bash
npm run dev
```

Navigate to `http://localhost:5174/productivity`. Confirm:
- "Sprint Output" tab shows existing charts
- "Output Multiplier" tab shows Direct/Parallel/Passive sub-tabs with empty states

- [ ] **Step 4: Commit**

```bash
git add src/pages/ProductivityPage.tsx
git commit -m "feat(ui): add Output Multiplier page tab to ProductivityPage"
```

---

## Task 11: Settings — Blended Hourly Rate

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Find the Settings NAV array**

Open `src/pages/Settings.tsx`. Find the `NAV` array (or equivalent sections list).

- [ ] **Step 2: Add the Output Multiplier section**

Add a new section entry to `NAV`:
```tsx
{ key: "output-multiplier", label: "Output Multiplier" }
```

Add the section content alongside the existing sections:
```tsx
{section === "output-multiplier" && (
  <SettingsSection title="Output Multiplier">
    <SettingsField
      label="Blended hourly rate (ZAR)"
      description="Used to calculate the equivalent human cost of passive agent output."
    >
      <input
        type="number"
        min={1}
        max={9999}
        className="input w-32"
        value={settings.blended_hourly_rate_zar ?? 350}
        onChange={(e) =>
          updateSettings({ blended_hourly_rate_zar: parseInt(e.target.value, 10) })
        }
      />
    </SettingsField>
  </SettingsSection>
)}
```

> **Note:** Use whatever existing pattern the Settings page uses for section rendering and field components — `SettingsSection`, `SettingsField`, etc. Match the exact pattern from the existing Productivity section (added in the spec for `productivity_goal_points`).

- [ ] **Step 3: Verify the settings page renders the new field**

Navigate to `http://localhost:5174/settings` → Output Multiplier. Confirm the rate field renders and saves.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(settings): add blended hourly rate field for output multiplier"
```

---

## Task 12: Generate Updated TypeScript Types

After all migrations are applied, regenerate the DB types so `settings.blended_hourly_rate_zar`, `ai_sessions`, and `agents` are typed.

- [ ] **Step 1: Regenerate types**

Use the project's Supabase MCP tool or CLI:

```bash
npx supabase gen types typescript \
  --project-id lpgwxacoqiqpcfpkklib > src/types/db.ts
```

- [ ] **Step 2: Verify the new types appear**

```bash
grep -n "blended_hourly_rate_zar\|ai_sessions\|agents" src/types/db.ts
```

Expected: lines showing the new columns and tables.

- [ ] **Step 3: Fix any type errors introduced**

```bash
npx tsc --noEmit
```

Fix any errors before committing.

- [ ] **Step 4: Commit**

```bash
git add src/types/db.ts
git commit -m "chore(types): regenerate DB types with ai_sessions, agents, blended_hourly_rate_zar"
```

---

## Self-Review Checklist (run after writing — do not delegate)

- [x] **Spec section 1 (Location):** Tasks 10 adds page tab to ProductivityPage ✓
- [x] **Spec section 2a (Direct view):** Task 6 implements bubble chart with 4 chips ✓
- [x] **Spec section 2b (Parallel view):** Task 7 implements session grid with 3 chips ✓
- [x] **Spec section 2c (Passive view):** Task 8 implements agent leaderboard with 3 chips ✓
- [x] **Spec section 3 (Data model):** Task 1 creates all tables with correct schema ✓
- [x] **Spec section 4 (/log ingestion):** Covered in Task 3 edge function. Note: `/log` **skill** extension (adding the 3 new prompt questions to the skill markdown) is **out of scope for this plan** — it requires modifying the skill file via the `superpowers:writing-skills` workflow separately.
- [x] **Spec section 5 (Edge function contracts):** Task 4 matches all response shapes ✓
- [x] **Spec section 6 (Hook):** Task 5 matches hook signature exactly ✓
- [x] **Spec section 7 (Components):** All 4 components created in Tasks 6–9 ✓
- [x] **Spec section 8 (Settings):** Task 11 adds blended rate field ✓
- [x] **Spec section 9 (Seed data):** Task 1 migration inserts all 5 agents ✓

**Gap noted:** The `/log` skill extension (spec section 4 — adding 3 new prompt questions) is not in this plan. It requires a separate invocation of `superpowers:writing-skills` to modify the skill file. Add a ClickUp task for this.

**Type consistency check:**
- `DirectData.members[].email` → used as `member.email` key in `DirectView` ✓
- `ParallelData.days[].sessions[].project_slug` → used in `sessionColor()` ✓
- `PassiveData.agents[].id` → used as key in `AGENT_ICONS` ✓
- `computeBubbleRadii` returns `{ innerR, middleR, outerR }` → destructured in `DirectView` ✓
- `formatCurrency` imported from `@/lib/format` in both `DirectView` and `PassiveView` ✓
