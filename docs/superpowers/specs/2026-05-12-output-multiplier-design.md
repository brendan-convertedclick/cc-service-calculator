# Output Multiplier — Design Spec

**Date:** 2026-05-12  
**Status:** Approved  
**Builds on:** `docs/superpowers/specs/2026-05-12-productivity-page-design.md`

---

## Overview

A new "Output Multiplier" tab on the `/productivity` page that measures how much AI amplifies each team member's output. Three sub-views — Direct, Parallel, and Passive — each capturing a different dimension of AI leverage as defined in the ccVolt wiki research (`ai-staff-productivity-measurement`, pages 07–08).

The feature answers the core question: **as AI takes on more of the work, how do we measure and attribute that productivity?**

---

## 1. Location in the App

The existing `/productivity` page gains a second top-level page tab:

```
[ Sprint Output ]   [ Output Multiplier ]   ← new
```

The `Output Multiplier` tab contains its own view switcher:

```
[ Direct ]   [ Parallel ]   [ Passive ]
```

The existing left sidebar (Team member selector) and period nav (◀ May 2026 ▶) are shared across both page tabs.

---

## 2. Three Views

### 2a. Direct — AI Leverage Ratio

**What it measures:** How much total output one person produces relative to the human hours they invested. Formula: `multiplier = (human_hours + ai_session_hours) / human_hours`. A person who spent 2h directing and 18h of AI sessions has a 10× multiplier — the AI produced 9 hours of output for every 1 human hour.

**Visualisation:** Concentric ring bubble chart — one bubble per team member.
- **Inner filled circle** — human hours invested (solid, person's colour)
- **Middle translucent ring** — AI session hours (same colour, 25% opacity)
- **Outer dashed ring** — effective output = human hours × multiplier (same colour, 8% opacity, dashed border)

The ratio of outer ring radius to inner circle radius is the multiplier, made visually immediate. A person at 8× has a dramatically larger outer ring than a person at 2×.

**Summary chips (4):**
- Avg Multiplier (period)
- Human Hours (period)
- AI Session Hours (period)
- AI Cost + cost-per-effective-hour (e.g. R3.31/hr)

**Data source:** `ai_sessions` Supabase table, queried per member per period.

---

### 2b. Parallel — Concurrent Session Multiplier

**What it measures:** How many Claude sessions ran simultaneously, producing N output streams from one person in the same wall-clock period. Formula from wiki page 07: `parallel_multiplier = concurrent_sessions × ai_duration_hours / human_wall_clock_hours`.

**Visualisation:** Session concurrency grid.
- Rows = simultaneous session slots (Session 1, Session 2, …)
- Columns = days (or tasks, for week view)
- Filled cells show project name, coloured by project
- More filled cells in a column = higher parallel multiplier that day
- Summary pill at bottom: "Week avg: 3.2× — equivalent to 3.2 people working simultaneously"

**Summary chips (3):**
- Avg Concurrent Sessions (period)
- Peak Sessions (single wall-clock hour)
- Parallel Output Hours (concurrent sessions × duration vs wall-clock)

**Data source:** `ai_sessions` table rows with `concurrent_sessions > 1`, logged via `/log`.

---

### 2c. Passive — Agent Attribution

**What it measures:** Output credited to a person from tools/skills they built that others (or automations) are running without their real-time involvement. Formula: `passive_hours = Σ (agent_runs × estimated_human_hours_per_run)`.

**Visualisation:** Agent leaderboard table.
- One row per agent built by the selected person
- Columns: agent icon, name, description, horizontal bar (proportional to runs), run count, equivalent human hours
- Total row at bottom: total passive hours + equivalent cost (`hours × blended_rate`)

**Summary chips (3):**
- Agents Built (by person)
- Total Passive Hours (period)
- Equivalent Human Cost (R, at blended rate from `settings.blended_hourly_rate_zar`)

**Data source:** `ai_sessions` rows where `engagement_type = 'agent-run'`, joined to `agents` registry. Populated via `/log` with engagement type `Agent Run`.

---

## 3. Data Model

### New Supabase tables

#### `ai_sessions`

Stores one row per Claude Code session as logged via `/log`.

```sql
create table ai_sessions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  logged_by       text not null,                    -- email of person who ran /log
  session_date    date not null,                    -- date of the session
  clickup_task_id text,                             -- optional task binding
  project_slug    text,                             -- e.g. 'cc-service-calculator', 'granite'
  ai_input_tokens  integer not null default 0,
  ai_output_tokens integer not null default 0,
  ai_duration_minutes numeric(8,2) not null default 0,
  ai_cost_zar     numeric(10,2) not null default 0,
  human_minutes   numeric(8,2) not null default 0,  -- from /scheduler estimate or manual
  concurrent_sessions integer not null default 1,
  engagement_type text not null default 'task',     -- 'task' | 'agent-run'
  agent_id        text                              -- fk to agents.id when engagement_type = 'agent-run'
);

create index ai_sessions_logged_by_date on ai_sessions (logged_by, session_date);
create index ai_sessions_engagement_type on ai_sessions (engagement_type);
```

#### `agents`

Registry of CC skills/agents with creator metadata. V1: seeded manually.

```sql
create table agents (
  id          text primary key,                     -- e.g. 'skill-intake'
  name        text not null,                        -- e.g. '/intake'
  description text not null,
  creator     text not null,                        -- email
  created_at  date not null,
  estimated_human_hours_per_run numeric(5,2) not null default 0.5
);
```

`agent_runs` is NOT a separate table — runs are rows in `ai_sessions` where `engagement_type = 'agent-run'` and `agent_id` is set. This keeps the data model flat.

### Settings table additions

```sql
alter table settings
  add column if not exists blended_hourly_rate_zar integer not null default 350;
```

Used to convert passive hours to a ZAR equivalent in the Passive view.

---

## 4. Data Ingestion — `/log` skill extension

The `/log` skill gains three new prompt questions (only asked when relevant):

```
1. How many concurrent Claude sessions were running? [number, default 1]
   → Stored as concurrent_sessions in ai_sessions

2. Was this an agent run? (y/n)
   → If y: Which agent? [select from agents registry]
   → Sets engagement_type = 'agent-run', agent_id = selected

3. Estimated human hours to do this without AI? [number]
   → Stored as human_minutes (× 60) — used for multiplier calc
   → Pre-fills from /scheduler estimate if task is bound
```

The skill reads the most recent JSONL file from `~/.claude/projects/<project>/` to extract:
- `ai_input_tokens`, `ai_output_tokens` (from usage blocks)
- `ai_duration_minutes` (session wall-clock from first to last message timestamp)

It then calls a new edge function `log-ai-session` which:
1. Writes to `ai_sessions` (Supabase)
2. PATCHes ClickUp task fields (`ai_input_tokens`, `ai_output_tokens`, `ai_cost_zar`, `ai_duration_minutes`) if `clickup_task_id` is bound

---

## 5. Edge Function — `get-output-multiplier`

**Location:** `supabase/functions/get-output-multiplier/index.ts`

**Request:**
```ts
{
  view: 'direct' | 'parallel' | 'passive'
  period: 'year' | 'month' | 'week'
  date: string        // ISO anchor date
  logged_by?: string  // email — omit for whole team
}
```

**Response (Direct view):**
```ts
{
  members: {
    email: string
    display_name: string
    human_hours: number
    ai_session_hours: number
    ai_cost_zar: number
    multiplier: number          // (human + ai) / human, capped at 20×
    effective_output_hours: number
  }[]
  totals: { avg_multiplier, total_human_hours, total_ai_hours, total_cost_zar }
}
```

**Response (Parallel view):**
```ts
{
  days: {
    date: string
    sessions: { slot: number; project_slug: string; duration_minutes: number }[]
    concurrent_count: number
    parallel_multiplier: number
  }[]
  summary: { avg_concurrent, peak_concurrent, parallel_output_hours, wall_clock_hours }
}
```

**Response (Passive view):**
```ts
{
  agents: {
    id: string
    name: string
    description: string
    runs: number
    estimated_human_hours: number
    blended_cost_zar: number
  }[]
  totals: { total_runs, total_passive_hours, total_cost_zar }
}
```

Deployed with `verify_jwt=false` (consistent with all edge functions in this project).

---

## 6. Frontend Hook — `useOutputMultiplier`

**Location:** `src/hooks/useOutputMultiplier.ts`

```ts
useOutputMultiplier(
  view: 'direct' | 'parallel' | 'passive',
  period: 'year' | 'month' | 'week',
  date: string,
  loggedBy?: string
)
```

- TanStack Query, `staleTime: 5 * 60_000`
- Calls `supabase.functions.invoke('get-output-multiplier', { body: {...} })`
- Query key: `['output-multiplier', view, period, date, loggedBy ?? 'team']`

---

## 7. Component Breakdown

| File | Purpose |
|---|---|
| `src/pages/ProductivityPage.tsx` | Add `pageTab` state (`sprint` \| `multiplier`), render tab switcher |
| `src/components/productivity/OutputMultiplierShell.tsx` | Sub-tab switcher (Direct/Parallel/Passive), period nav, shared chips |
| `src/components/productivity/DirectView.tsx` | Concentric ring bubble chart + 4 summary chips |
| `src/components/productivity/ParallelView.tsx` | Session concurrency grid + 3 summary chips |
| `src/components/productivity/PassiveView.tsx` | Agent leaderboard table + 3 summary chips |
| `src/hooks/useOutputMultiplier.ts` | TanStack Query hook |
| `supabase/functions/get-output-multiplier/index.ts` | Edge function (all three views) |
| `supabase/functions/log-ai-session/index.ts` | Write session row + patch ClickUp task |
| `supabase/migrations/YYYYMMDD_ai_sessions.sql` | `ai_sessions` + `agents` tables + settings column |

### Bubble chart implementation note

The concentric ring chart is built with SVG (no additional charting library). Each bubble is a `<g>` containing three `<circle>` elements. Radii are computed as:

```ts
const BASE_RADIUS = 20          // inner circle minimum px
const MAX_RADIUS = 90           // outer ring maximum px

innerR  = BASE_RADIUS + Math.sqrt(human_hours) * 8
middleR = innerR + Math.sqrt(ai_session_hours) * 6
outerR  = Math.min(innerR * multiplier, MAX_RADIUS)
```

Bubbles are laid out in a flex row, each in a fixed 200×200 SVG viewport.

---

## 8. Settings Integration

Add "Output Multiplier" section to `src/pages/Settings.tsx`:
- **Blended hourly rate (ZAR)** — integer, used for passive cost equivalents
- Input validates: integer, min 1, max 9999

---

## 9. Seed Data — Agents Registry

V1 agents (seeded via migration):

| id | name | est. human hrs/run |
|---|---|---|
| skill-intake | /intake | 0.5 |
| skill-log | /log | 0.25 |
| skill-brief | /brief | 0.5 |
| skill-scheduler | /scheduler | 0.5 |
| skill-sow | /sow | 1.0 |

All creator: `brendan@convertedclick.co.za`.

---

## 10. Out of Scope for V1

- Automatic session detection (no Stop hook writing to `ai_sessions` directly — manual `/log` only)
- Per-agent version tracking / upgrade attribution
- Multi-creator agent attribution (all agents are Brendan's for now)
- Revision cycles / quality score (separate initiative per wiki page 06)
- Export / sharing of charts
- Real-time updates (5-min stale time is sufficient)
