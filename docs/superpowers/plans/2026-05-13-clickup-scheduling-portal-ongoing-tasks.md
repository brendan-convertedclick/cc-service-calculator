# ClickUp Scheduling Portal — Ongoing Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "ongoing tasks" model so internal overhead time (standups, internal meetings, admin, comms, learning, sales/BD) is scheduled through this app, lives as perpetual per-person ClickUp tasks that Rize.io posts time entries against, gets read back into this DB for variance reporting, and is excluded from delivery velocity math.

**Architecture:** Two new tables — `time_categories` (canonical list of overhead types, seeded) and `ongoing_tasks` (per `team_member × time_category` instance with a `clickup_task_id`). A new edge function `provision-ongoing-tasks` creates ClickUp tasks in a dedicated "Internal" list (configured once in Settings); the Team page exposes a provisioning button per member. The existing `sync-clickup-actuals` edge function is extended to pull time entries for every active ongoing task into an append-only `ongoing_actuals` table. The productivity views are updated so ongoing hours roll up under a new "Overhead" series, distinct from delivery velocity. Rize handles activity→task matching on its own side; this app just guarantees the ClickUp tasks exist with predictable names.

**Tech Stack:** Postgres (Supabase) migrations, Deno edge functions (`supabase/functions/`), React 18 + TypeScript + Tailwind + shadcn/ui, TanStack Query, Vitest.

---

## File Structure

**Database (new migration):**
- Create: `supabase/migrations/0046_ongoing_tasks.sql` — `time_categories`, `ongoing_tasks`, `ongoing_actuals` tables, seeds, `settings.clickup_internal_list_id`.

**Edge functions:**
- Create: `supabase/functions/provision-ongoing-tasks/index.ts` — given `team_member_id`, ensures one ClickUp task per active `time_category` exists for that member in the configured internal list, and a corresponding `ongoing_tasks` row.
- Modify: `supabase/functions/sync-clickup-actuals/index.ts` — after the project sync loop, also iterate `ongoing_tasks WHERE archived_at IS NULL`, pull `/task/{id}/time`, insert into `ongoing_actuals`.

**App (types + hooks + pages):**
- Create: `src/hooks/useOngoingTasks.ts` — TanStack Query hooks: `useTimeCategories`, `useOngoingTasksForMember`, `useProvisionOngoingTasks`, `useUpsertTimeCategory`, `useArchiveTimeCategory`.
- Modify: `src/types/db.ts` — add `TimeCategory`, `OngoingTask`, `OngoingActual` types.
- Modify: `src/pages/Team.tsx` — add a "Provision ongoing tasks" button per row + a count badge of active ongoing tasks.
- Modify: `src/pages/Settings.tsx` — add a "Time categories" section that lists/edits seeded categories and lets the user paste a ClickUp internal-list ID.
- Modify: `src/components/productivity/HoursTrackedChart.tsx` — split each bucket into `delivery` + `overhead` stacks.
- Modify: `src/hooks/useProductivity.ts` — extend payload with `overhead_hours` per bucket; ensure `delivery_hours` excludes ongoing tasks.
- Modify: `supabase/functions/get-productivity/index.ts` — extend the SQL to read `ongoing_actuals` and return overhead-hours per bucket alongside the existing delivery roll-up.

**Tests:**
- Create: `supabase/functions/provision-ongoing-tasks/index.test.ts`
- Create: `src/hooks/useOngoingTasks.test.ts`
- Modify: `src/components/productivity/HoursTrackedChart.test.tsx` (or create if missing) — assert stacked rendering.

**Docs:**
- Modify: `CLAUDE.md` — add a short "Ongoing tasks model" section under Project conventions.

---

## Task 1: Migration — schema for time categories, ongoing tasks, ongoing actuals

**Files:**
- Create: `supabase/migrations/0046_ongoing_tasks.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/0046_ongoing_tasks.sql
--
-- Ongoing tasks model. Each (team_member × time_category) gets one
-- perpetual ClickUp task in the configured internal list. Rize posts
-- time entries against those task IDs; sync-clickup-actuals pulls them
-- back into ongoing_actuals as an append-only snapshot stream.

-- 1. Settings: a single ClickUp list that holds every internal task.
alter table public.settings
  add column if not exists clickup_internal_list_id text;

comment on column public.settings.clickup_internal_list_id is
  'ClickUp list ID that hosts all perpetual ongoing tasks (Standup, '
  'Admin, etc). One list, all team members, all categories.';

-- 2. time_categories — canonical overhead types. Hand-edited via the
--    Settings UI. label_key is a slug used in ClickUp task naming so
--    Rize can match consistently even if the display label changes.
create table public.time_categories (
  id           uuid primary key default gen_random_uuid(),
  label_key    text not null unique,            -- e.g. 'standup'
  label        text not null,                   -- e.g. 'Standup'
  description  text,
  weekly_budget_hours numeric(5,2),             -- optional soft target
  display_order int  not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index time_categories_active_idx
  on public.time_categories (display_order)
  where archived_at is null;

-- 3. ongoing_tasks — one row per (team_member × time_category).
--    clickup_task_id is set once when provisioned; the task is never
--    closed and never re-created. archived_at retires the row when a
--    team member leaves or a category is removed.
create table public.ongoing_tasks (
  id                uuid primary key default gen_random_uuid(),
  team_member_id    uuid not null references public.team_members(id) on delete cascade,
  time_category_id  uuid not null references public.time_categories(id) on delete restrict,
  clickup_task_id   text not null,
  task_name         text not null,             -- the name we pushed (for audit)
  provisioned_at    timestamptz not null default now(),
  archived_at       timestamptz,
  unique (team_member_id, time_category_id)
);

create index ongoing_tasks_member_active_idx
  on public.ongoing_tasks (team_member_id)
  where archived_at is null;

create index ongoing_tasks_clickup_idx
  on public.ongoing_tasks (clickup_task_id);

-- 4. ongoing_actuals — append-only snapshots of time entries per
--    ongoing task per sync tick. Mirrors project_actuals' append-only
--    pattern from migration 0013. Each row holds the cumulative hours
--    on that task at sync time; downstream views subtract earlier rows
--    to derive per-period hours.
create table public.ongoing_actuals (
  id               uuid primary key default gen_random_uuid(),
  ongoing_task_id  uuid not null references public.ongoing_tasks(id) on delete cascade,
  clickup_task_id  text not null,
  cumulative_hours numeric(8,2) not null default 0,
  time_entries     jsonb,                       -- raw ClickUp payload for audit
  synced_at        timestamptz not null default now()
);

create index ongoing_actuals_task_synced_idx
  on public.ongoing_actuals (ongoing_task_id, synced_at desc);

-- 5. Latest-snapshot view, used by get-productivity to compute
--    per-period hours via lag().
create or replace view public.ongoing_actuals_current as
  select distinct on (ongoing_task_id)
    ongoing_task_id,
    clickup_task_id,
    cumulative_hours,
    synced_at
  from public.ongoing_actuals
  order by ongoing_task_id, synced_at desc;

-- 6. Seed the default time categories. These mirror the agreed bucket
--    set: Standup, Internal Meetings, Admin/Comms, Learning, Sales/BD.
insert into public.time_categories (label_key, label, description, display_order)
values
  ('standup',           'Standup',           'Daily team stand-up',                       10),
  ('internal-meetings', 'Internal Meetings', 'Non-client meetings (1:1s, retros, etc.)',  20),
  ('admin-comms',       'Admin / Comms',     'Slack, email, internal docs, ops admin',    30),
  ('learning',          'Learning',          'Training, reading, skill-up',               40),
  ('sales-bd',          'Sales / BD',        'Pitches, proposals, prospecting',           50)
on conflict (label_key) do nothing;
```

- [ ] **Step 2: Apply the migration via the project-scoped MCP**

Use `mcp__cc-supabase__apply_migration` with `name=0046_ongoing_tasks` and the SQL above. CLAUDE.md mandates `cc-supabase` (not the default `supabase` MCP) — the default points at a different project.

Expected: migration applied; `list_tables` should now show `time_categories`, `ongoing_tasks`, `ongoing_actuals`, and `settings.clickup_internal_list_id` is present.

- [ ] **Step 3: Regenerate TypeScript types**

Run: `npm run -s types:generate` (or `npx supabase gen types typescript --project-id lpgwxacoqiqpcfpkklib > src/types/database.ts` — match the repo's existing script name found in `package.json`).

Expected: `src/types/database.ts` includes `time_categories`, `ongoing_tasks`, `ongoing_actuals`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0046_ongoing_tasks.sql src/types/database.ts
git commit -m "feat(ongoing-tasks): schema + seed for overhead time categories"
```

---

## Task 2: Type aliases for ongoing tasks

**Files:**
- Modify: `src/types/db.ts`

- [ ] **Step 1: Add the type re-exports**

Append to `src/types/db.ts`:

```ts
import type { Database } from "./database";

export type TimeCategory = Database["public"]["Tables"]["time_categories"]["Row"];
export type OngoingTask = Database["public"]["Tables"]["ongoing_tasks"]["Row"];
export type OngoingActual = Database["public"]["Tables"]["ongoing_actuals"]["Row"];

export type OngoingTaskWithCategory = OngoingTask & {
  time_category: TimeCategory;
};
```

(If `Database` is already imported at the top of the file, reuse the existing import — don't duplicate.)

- [ ] **Step 2: Type-check**

Run: `npm run -s typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/db.ts
git commit -m "feat(ongoing-tasks): add row type aliases"
```

---

## Task 3: Edge function — `provision-ongoing-tasks`

**Files:**
- Create: `supabase/functions/provision-ongoing-tasks/index.ts`
- Create: `supabase/functions/provision-ongoing-tasks/index.test.ts`
- Modify: `supabase/config.toml` (or wherever functions are listed) to register the new function with `verify_jwt=false` per the project memory `project_es256_edge_fn_auth.md`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/provision-ongoing-tasks/index.test.ts
import { assertEquals } from "jsr:@std/assert";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init));
}

Deno.test("provision-ongoing-tasks names tasks predictably for Rize matching", async () => {
  const calls: string[] = [];
  mockFetch((url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/task") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: `cu-${body.name}`, name: body.name }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });

  const { buildTaskName } = await import("./index.ts");
  assertEquals(
    buildTaskName({ full_name: "Brendan Gunn" }, { label: "Standup", label_key: "standup" }),
    "[Internal] Brendan Gunn — Standup",
  );
  globalThis.fetch = ORIGINAL_FETCH;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/provision-ongoing-tasks/index.test.ts --allow-env --allow-net`
Expected: FAIL — `Cannot find module './index.ts'`.

- [ ] **Step 3: Implement the function**

```ts
// supabase/functions/provision-ongoing-tasks/index.ts
//
// Request:  POST { team_member_id: string }
// Response: 200 { provisioned: number, skipped: number, ongoing_tasks: [...] }
//
// For every active time_category, ensure there's an ongoing_tasks row
// for this team member. If missing, create a ClickUp task in the
// configured internal list, then insert the row.
//
// Idempotent: re-runs do nothing if everything is already provisioned.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

export function buildTaskName(
  member: { full_name: string },
  category: { label: string; label_key: string },
): string {
  return `[Internal] ${member.full_name} — ${category.label}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { team_member_id } = await req.json() as { team_member_id?: string };
    if (!team_member_id) return json({ error: "team_member_id required" }, 400);

    const supabase = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");

    const { data: settings } = await supabase
      .from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled) return json({ error: "ClickUp disabled" }, 400);
    if (!settings.clickup_internal_list_id) {
      return json({ error: "clickup_internal_list_id not set in settings" }, 400);
    }
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    const { data: member, error: mErr } = await supabase
      .from("team_members")
      .select("id, full_name, clickup_user_id, archived_at")
      .eq("id", team_member_id).single();
    if (mErr || !member) return json({ error: mErr?.message ?? "Member not found" }, 404);
    if (member.archived_at) return json({ error: "Member is archived" }, 400);

    const { data: categories } = await supabase
      .from("time_categories")
      .select("*")
      .is("archived_at", null)
      .order("display_order");

    const { data: existing } = await supabase
      .from("ongoing_tasks")
      .select("time_category_id")
      .eq("team_member_id", team_member_id)
      .is("archived_at", null);
    const existingByCat = new Set((existing ?? []).map((r) => r.time_category_id));

    const CU = {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    };
    const listId = settings.clickup_internal_list_id;

    let provisioned = 0;
    let skipped = 0;
    const created: Array<{ category: string; clickup_task_id: string }> = [];

    for (const cat of (categories ?? [])) {
      if (existingByCat.has(cat.id)) { skipped++; continue; }

      const name = buildTaskName(member, cat);
      const cuRes = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
        ...CU,
        method: "POST",
        body: JSON.stringify({
          name,
          description:
            `Ongoing time bucket for ${member.full_name}.\n` +
            `Category: ${cat.label}. Rize posts time entries here.\n` +
            `Do not close — this task is perpetual.`,
          assignees: member.clickup_user_id ? [member.clickup_user_id] : [],
          status: "in progress",
        }),
      });
      if (!cuRes.ok) {
        return json({ error: `CU task create failed: ${await cuRes.text()}` }, 502);
      }
      const cuTask = await cuRes.json();

      const { error: insErr } = await supabase.from("ongoing_tasks").insert({
        team_member_id: member.id,
        time_category_id: cat.id,
        clickup_task_id: cuTask.id,
        task_name: name,
      });
      if (insErr) return json({ error: insErr.message }, 500);

      provisioned++;
      created.push({ category: cat.label, clickup_task_id: cuTask.id });
    }

    return json({ provisioned, skipped, created });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/provision-ongoing-tasks/index.test.ts --allow-env --allow-net`
Expected: PASS.

- [ ] **Step 5: Deploy with verify_jwt=false**

Use `mcp__cc-supabase__deploy_edge_function` with `name=provision-ongoing-tasks`, `verify_jwt=false` per `project_es256_edge_fn_auth.md`. Verify via `mcp__cc-supabase__list_edge_functions` that it appears.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/provision-ongoing-tasks/ supabase/config.toml
git commit -m "feat(ongoing-tasks): provision-ongoing-tasks edge function"
```

---

## Task 4: Hooks — `useOngoingTasks.ts`

**Files:**
- Create: `src/hooks/useOngoingTasks.ts`
- Create: `src/hooks/useOngoingTasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useOngoingTasks.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTimeCategories } from "./useOngoingTasks";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () =>
            Promise.resolve({
              data: [{ id: "c1", label_key: "standup", label: "Standup", display_order: 10, archived_at: null }],
              error: null,
            }),
        }),
      }),
    }),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useTimeCategories", () => {
  it("returns active categories in display order", async () => {
    const { result } = renderHook(() => useTimeCategories(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.label).toBe("Standup");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/hooks/useOngoingTasks.test.ts`
Expected: FAIL — `Cannot find module './useOngoingTasks'`.

- [ ] **Step 3: Implement the hooks**

```ts
// src/hooks/useOngoingTasks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { TimeCategory, OngoingTaskWithCategory } from "@/types/db";

export function useTimeCategories() {
  return useQuery<TimeCategory[]>({
    queryKey: ["time-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_categories")
        .select("*")
        .is("archived_at", null)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOngoingTasksForMember(memberId: string | null) {
  return useQuery<OngoingTaskWithCategory[]>({
    queryKey: ["ongoing-tasks", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ongoing_tasks")
        .select("*, time_category:time_categories(*)")
        .eq("team_member_id", memberId!)
        .is("archived_at", null);
      if (error) throw error;
      return (data ?? []) as OngoingTaskWithCategory[];
    },
  });
}

export function useProvisionOngoingTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamMemberId: string) => {
      const { data, error } = await supabase.functions.invoke(
        "provision-ongoing-tasks",
        { body: { team_member_id: teamMemberId } },
      );
      if (error) throw error;
      if ((data as { error?: string }).error) throw new Error((data as { error: string }).error);
      return data as { provisioned: number; skipped: number };
    },
    onSuccess: (_d, teamMemberId) => {
      qc.invalidateQueries({ queryKey: ["ongoing-tasks", teamMemberId] });
    },
  });
}

export function useUpsertTimeCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TimeCategory> & { id?: string }) => {
      if (patch.id) {
        const { error } = await supabase
          .from("time_categories")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", patch.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("time_categories").insert(patch);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-categories"] }),
  });
}

export function useArchiveTimeCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("time_categories")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-categories"] }),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/hooks/useOngoingTasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOngoingTasks.ts src/hooks/useOngoingTasks.test.ts
git commit -m "feat(ongoing-tasks): hooks for categories, provisioning, mutations"
```

---

## Task 5: Settings UI — internal list ID + time categories editor

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Read the current Settings page**

Run: `cat src/pages/Settings.tsx | head -40` to confirm the existing layout (Card-based sections) and the hook used to read/write `settings`.

- [ ] **Step 2: Add the internal list ID input**

Inside the existing ClickUp settings Card (the one that already shows `clickup_workspace_id`), append a second input. The exact JSX (drop in after the workspace ID input):

```tsx
<div className="space-y-2">
  <Label>ClickUp internal list ID</Label>
  <Input
    defaultValue={settings?.clickup_internal_list_id ?? ""}
    placeholder="901234567890"
    onBlur={(e) => {
      const v = e.target.value.trim() || null;
      if (v !== (settings?.clickup_internal_list_id ?? null)) {
        updateSettings.mutate({ clickup_internal_list_id: v });
      }
    }}
  />
  <p className="text-xs text-muted-foreground">
    List where perpetual ongoing tasks live (Standup, Admin, Learning, etc.).
    One list, all team members. Create it in ClickUp first, then paste the ID.
  </p>
</div>
```

(Reuse the existing `updateSettings` mutation and `settings` query — if the page does not currently expose `clickup_internal_list_id` in its TS shape, regenerated types from Task 1 will already include it.)

- [ ] **Step 3: Add the time categories editor section**

Below the existing settings cards, add:

```tsx
import { useTimeCategories, useUpsertTimeCategory, useArchiveTimeCategory } from "@/hooks/useOngoingTasks";

function TimeCategoriesCard() {
  const { data: cats = [] } = useTimeCategories();
  const upsert = useUpsertTimeCategory();
  const archive = useArchiveTimeCategory();
  const [newLabel, setNewLabel] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time categories</CardTitle>
        <p className="text-sm text-muted-foreground">
          Overhead buckets used for ongoing tasks. Each is provisioned as a
          perpetual ClickUp task per team member.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <Input
              defaultValue={c.label}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.label) upsert.mutate({ id: c.id, label: v });
              }}
              className="flex-1"
            />
            <Input
              type="number"
              step="0.25"
              defaultValue={c.weekly_budget_hours ?? ""}
              placeholder="hrs/wk"
              className="w-24"
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const v = raw === "" ? null : Number(raw);
                if (v !== c.weekly_budget_hours) upsert.mutate({ id: c.id, weekly_budget_hours: v });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm(`Archive "${c.label}"? Existing tasks stay; no new tasks will be provisioned.`)) {
                  archive.mutate(c.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2 border-t">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New category label (e.g. Sales / BD)"
            className="flex-1"
          />
          <Button
            onClick={() => {
              const label = newLabel.trim();
              if (!label) return;
              const label_key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
              upsert.mutate(
                { label, label_key, display_order: (cats[cats.length - 1]?.display_order ?? 0) + 10 },
                { onSuccess: () => setNewLabel("") },
              );
            }}
          >
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

Mount `<TimeCategoriesCard />` inside the Settings page main column, below the ClickUp card. Import `Trash2` from `lucide-react` and `useState` from `react` if not already imported.

- [ ] **Step 4: Manual verify in the dev server**

Run: `npm run dev -- --port 5174` (port pinned per CLAUDE.md).
Open `http://localhost:5174/settings`. Confirm:
- Internal list ID input appears under the ClickUp card.
- Time Categories card lists the 5 seeded categories.
- Adding a new category appends a row; archiving removes it from the list.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(ongoing-tasks): Settings UI for internal list + time categories"
```

---

## Task 6: Team page — provision button per member

**Files:**
- Modify: `src/pages/Team.tsx`

- [ ] **Step 1: Add a provisioning column to the table**

After the existing "Skills" `<th>` and before "Cost / hr", add:

```tsx
<th className="py-2">Ongoing</th>
```

In each `<tr>`, after the SkillsEditor `<td>`, add a new cell that uses the hooks from Task 4:

```tsx
import { useOngoingTasksForMember, useProvisionOngoingTasks } from "@/hooks/useOngoingTasks";
import { useTimeCategories } from "@/hooks/useOngoingTasks";

// inside the row render — extract into a small subcomponent to avoid
// calling hooks inside .map (each row needs its own hook state).
function OngoingCell({ memberId }: { memberId: string }) {
  const { data: cats = [] } = useTimeCategories();
  const { data: tasks = [], isLoading } = useOngoingTasksForMember(memberId);
  const provision = useProvisionOngoingTasks();
  const missing = cats.length - tasks.length;

  return (
    <td className="py-3 pr-2">
      <div className="flex items-center gap-2">
        <Badge variant={missing > 0 ? "destructive" : "secondary"}>
          {isLoading ? "…" : `${tasks.length}/${cats.length}`}
        </Badge>
        {missing > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={provision.isPending}
            onClick={() =>
              provision.mutate(memberId, {
                onSuccess: (d) => toast.success(`Provisioned ${d.provisioned} task(s)`),
                onError: (e) => toast.error(e.message),
              })
            }
          >
            {provision.isPending ? "…" : "Provision"}
          </Button>
        )}
      </div>
    </td>
  );
}
```

Then render `<OngoingCell memberId={m.id} />` in each row. Drop the inline `<td>` and place this subcomponent inside the same `<tr>`.

- [ ] **Step 2: Type-check + run existing tests**

Run: `npm run -s typecheck && npm test -- src/pages/`
Expected: PASS.

- [ ] **Step 3: Manual verify**

In dev server, open `/team`. For an existing member, confirm the badge shows `0/5` and a "Provision" button appears. Click it. With Settings.clickup_internal_list_id set and CLICKUP_PAT secret configured, expect a toast and the badge flips to `5/5`. Verify in ClickUp that 5 tasks appear in the internal list, named `[Internal] {full_name} — {category}`.

If `clickup_internal_list_id` is unset, expect an error toast — that's the intended guard.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Team.tsx
git commit -m "feat(ongoing-tasks): provision button + status badge on Team page"
```

---

## Task 7: Extend `sync-clickup-actuals` to read ongoing time

**Files:**
- Modify: `supabase/functions/sync-clickup-actuals/index.ts`

- [ ] **Step 1: Add the ongoing-task sync block**

Open `supabase/functions/sync-clickup-actuals/index.ts`. After the existing `for (const p of projects ?? [])` loop closes (line ~205) but before `return json({ inserted })`, add:

```ts
    // Ongoing tasks — perpetual per-person overhead tasks. Pull current
    // time entries and append a snapshot. No "all done" rollup; these
    // tasks never close.
    const { data: ongoing } = await supabase
      .from("ongoing_tasks")
      .select("id, clickup_task_id")
      .is("archived_at", null);

    let ongoingInserted = 0;
    for (const ot of (ongoing ?? []) as Array<{ id: string; clickup_task_id: string }>) {
      const teRes = await fetch(
        `https://api.clickup.com/api/v2/task/${ot.clickup_task_id}/time`,
        CU,
      );
      if (!teRes.ok) continue;
      const timeEntries = (await teRes.json()).data ?? [];
      const cumulativeHours = timeEntries.reduce(
        (acc: number, e: { time?: number | string }) =>
          acc + Number(e.time ?? 0) / 3_600_000,
        0,
      );

      const { error: insErr } = await supabase.from("ongoing_actuals").insert({
        ongoing_task_id: ot.id,
        clickup_task_id: ot.clickup_task_id,
        cumulative_hours: cumulativeHours,
        time_entries: timeEntries,
      });
      if (insErr) {
        console.error("ongoing_actuals insert failed:", insErr.message);
        continue;
      }
      ongoingInserted++;
    }

    return json({ inserted, ongoing_inserted: ongoingInserted });
```

Replace the existing `return json({ inserted })` with the new return that includes `ongoing_inserted`.

- [ ] **Step 2: Deploy the updated edge function**

Use `mcp__cc-supabase__deploy_edge_function` with `name=sync-clickup-actuals`, `verify_jwt=false`.

- [ ] **Step 3: Manual smoke**

Invoke the function once via curl or `mcp__cc-supabase__get_logs` confirms an `ongoing_inserted: N` line. Use `mcp__cc-supabase__execute_sql` with `select count(*) from ongoing_actuals;` — should be ≥ N.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/sync-clickup-actuals/index.ts
git commit -m "feat(ongoing-tasks): sync time entries into ongoing_actuals"
```

---

## Task 8: Productivity — split delivery vs overhead hours

**Files:**
- Modify: `supabase/functions/get-productivity/index.ts`
- Modify: `src/hooks/useProductivity.ts`
- Modify: `src/components/productivity/HoursTrackedChart.tsx`

- [ ] **Step 1: Inspect the current get-productivity payload**

Run: `grep -n "actual_hours\|hours" supabase/functions/get-productivity/index.ts | head -30`. Identify where the per-bucket hours roll-up happens and what shape it currently returns.

- [ ] **Step 2: Add overhead hours to the response**

In `supabase/functions/get-productivity/index.ts`, after the existing delivery roll-up that produces `bucket, hours_tracked`, add a parallel block:

```ts
    // Overhead hours per bucket — derived from ongoing_actuals.
    // We compute per-period hours via lag(): cumulative_hours(t) -
    // cumulative_hours(t-1) within each ongoing_task. Negative deltas
    // (ClickUp time entry deletions) are clipped to 0.
    const { data: overheadRows } = await supabase.rpc("ongoing_hours_per_bucket", {
      p_start: startIso,
      p_end: endIso,
      p_bucket_unit: bucketUnit,            // 'week' | 'month' — match existing param
    });

    const overheadByBucket = new Map<string, number>(
      (overheadRows ?? []).map((r: { bucket: string; hours: number }) => [r.bucket, Number(r.hours)]),
    );

    // Merge into the existing buckets array.
    for (const b of buckets) {
      b.overhead_hours = overheadByBucket.get(b.bucket) ?? 0;
    }
```

Then declare the RPC by adding to `supabase/migrations/0046_ongoing_tasks.sql` (append before commit of Task 1 if not already done; otherwise create `0047_ongoing_hours_rpc.sql`):

```sql
create or replace function public.ongoing_hours_per_bucket(
  p_start timestamptz,
  p_end   timestamptz,
  p_bucket_unit text
) returns table (bucket text, hours numeric) language sql stable as $$
  with deltas as (
    select
      oa.ongoing_task_id,
      oa.synced_at,
      greatest(
        oa.cumulative_hours - coalesce(lag(oa.cumulative_hours)
          over (partition by oa.ongoing_task_id order by oa.synced_at), 0),
        0
      ) as delta_hours
    from public.ongoing_actuals oa
    where oa.synced_at >= p_start and oa.synced_at < p_end
  )
  select
    to_char(date_trunc(p_bucket_unit, synced_at), 'YYYY-MM-DD') as bucket,
    sum(delta_hours) as hours
  from deltas
  group by 1
  order by 1;
$$;
```

If you've already committed Task 1's migration, add this as `0047_ongoing_hours_rpc.sql` instead and apply it via `mcp__cc-supabase__apply_migration`.

- [ ] **Step 3: Update the productivity hook type**

In `src/hooks/useProductivity.ts`, extend the per-bucket row type:

```ts
export interface ProductivityBucket {
  bucket: string;
  hours_tracked: number;
  overhead_hours: number;           // new
  // ...other existing fields unchanged
}
```

- [ ] **Step 4: Update the chart to stack delivery + overhead**

In `src/components/productivity/HoursTrackedChart.tsx`, locate the existing `<Bar dataKey="hours_tracked" ... />` and replace it with a stacked pair:

```tsx
<Bar dataKey="delivery_hours" stackId="hours" fill="var(--mcolor-primary)" name="Delivery" />
<Bar dataKey="overhead_hours" stackId="hours" fill="var(--mcolor-tertiary)" name="Overhead" />
```

If the existing chart uses `hours_tracked` as a single value, compute `delivery_hours = hours_tracked - overhead_hours` in the data prep step inside the component (or upstream in the hook — pick whichever the file already does for derived fields, to stay consistent).

- [ ] **Step 5: Type-check and run tests**

Run: `npm run -s typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Manual verify**

In dev server, open `/productivity`. Confirm the Hours Tracked chart shows a stacked bar with two colours and a legend distinguishing Delivery vs Overhead. With no ongoing actuals yet (fresh install), overhead should render at 0 — verify there's no NaN or empty-frame regression.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/get-productivity/index.ts \
        supabase/migrations/0047_ongoing_hours_rpc.sql \
        src/hooks/useProductivity.ts \
        src/components/productivity/HoursTrackedChart.tsx
git commit -m "feat(ongoing-tasks): split delivery vs overhead hours in productivity"
```

---

## Task 9: Documentation in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append the ongoing-tasks section**

Add a new section under **Project conventions**, just below the "AI" bullet:

```md
- **Ongoing tasks (overhead):** Time spent on standups, internal meetings, admin, learning, and sales/BD is tracked via *perpetual* per-person ClickUp tasks living in `settings.clickup_internal_list_id`. Provision them from the Team page once per member. Task names follow `[Internal] {full_name} — {Category}` so Rize.io can auto-match. These tasks never close. Time flows in from Rize → ClickUp → `ongoing_actuals` (via the existing `sync-clickup-actuals` cron). They are excluded from delivery velocity but appear as the "Overhead" stack in the Productivity Hours Tracked chart.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: ongoing-tasks model overview in CLAUDE.md"
```

---

## Manual verification at the end (whole-feature smoke)

After all tasks are merged, run through this end-to-end on a fresh test ClickUp list:

1. In Settings → set `clickup_internal_list_id` to a real ClickUp list in the team workspace.
2. On Team page → for one member, click **Provision**. Confirm 5 tasks appear in the ClickUp list with names matching `[Internal] {full_name} — {Category}`.
3. In ClickUp → manually log 15 minutes on the member's "Standup" task (simulates Rize posting a time entry).
4. Trigger the sync edge function (curl or wait for the cron tick from migration 0011).
5. Run `select cumulative_hours from ongoing_actuals where ongoing_task_id = '…' order by synced_at desc limit 1;` via `mcp__cc-supabase__execute_sql` — expect `0.25`.
6. Open Productivity page → Hours Tracked bar for the current week should show a small Overhead segment.
7. In Team page → archive the member. Confirm ongoing_tasks rows for that member remain (cascade is via team_members; only soft-delete on the member happens, so the rows still exist but become orphaned — acceptable for V1). Confirm the next sync tick still works without error.

---

## Out of scope for this plan (do NOT implement)

- ClickUp lockout enforcement (webhook that flags non-app-originated tasks). User said they're not worried; natural consequence of bypassing this app is uncategorised time in Rize.
- Ad-hoc task brief UI (one-off delivery tasks not tied to a quote). The `/brief` skill already covers this via the cc-calculator MCP; expanding it is a separate plan.
- Per-team (shared) ongoing tasks. We picked per-person.
- Rize-side configuration. Rize handles its own matching; we just guarantee the ClickUp tasks exist with stable names.
- Two-way edits (renaming a category does not rename existing ClickUp tasks). If the user needs that, add a follow-up task to PATCH ClickUp task names on category label updates.

---

## Self-review notes (filled in by author)

- **Spec coverage:** Per-person bucket model ✅ (Tasks 1, 3, 6). Generator-provisioned ✅ (Tasks 3, 6). ClickUp-as-bus ✅ (Task 7 reads back, no Rize API needed). Naming convention ✅ (Task 3, `buildTaskName`). No lockout ✅ (intentionally out of scope). Productivity carve-out ✅ (Task 8).
- **Placeholders:** None. Every step has actual code or an exact command.
- **Type consistency:** `time_categories.label_key`, `ongoing_tasks.clickup_task_id`, and `ongoing_actuals.cumulative_hours` are used identically across SQL, edge functions, and React hooks. The `buildTaskName` signature is consistent between the test and implementation.
