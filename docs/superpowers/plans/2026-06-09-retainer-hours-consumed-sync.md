# Retainer Hours Consumed + Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show current-month hours consumed (used/target + RAG burn bar) per retainer on the Retainers list, with per-row and "Sync all" controls that pull ClickUp tracked time — including from retainer provisioned tasks, which currently never reach the actuals pipeline.

**Architecture:** Extend `sync-clickup-actuals` to fold each project's current-period `provisioned_tasks` ClickUp task IDs into the actuals set it already syncs, so retainer task-time lands in `project_actuals` and the existing `computeRetainerBurn` (via `usePulseRetainerBurn`) just works. The list reuses that hook for the new column; a thin `useSyncActuals` mutation drives both sync controls.

**Tech Stack:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui + TanStack Query (frontend, vitest + Testing Library); Supabase Edge Functions on Deno (pure logic in `_shared/*-logic.ts`, tested with `deno test`).

**Deploy note:** After Task 2, redeploy the function with the project's deploy path:
`unset SUPABASE_ACCESS_TOKEN && supabase functions deploy sync-clickup-actuals --project-ref lpgwxacoqiqpcfpkklib` (the CLI falls back to the macOS Keychain login; Docker warning is harmless).

---

## File Structure

**Backend**
- Create `supabase/functions/_shared/retainer-actuals-logic.ts` — pure `collectProvisionedActuals()`: from a retainer's `provisioned_tasks` rows, return the project_actuals seed entries for current-period tasks not already tracked. No Deno/Supabase deps (vitest/deno-testable).
- Create `supabase/functions/_shared/retainer-actuals-logic.test.ts` — Deno tests for the pure function.
- Modify `supabase/functions/sync-clickup-actuals/index.ts` — bulk-fetch provisioned tasks per project and fold the seed entries into each project's `actuals` array before the existing sync loop.

**Frontend**
- Create `src/hooks/useSyncActuals.ts` — mutation wrapping `sync-clickup-actuals` invoke + cache invalidation; optional `projectId` (omit = sync all).
- Create `src/hooks/useSyncActuals.test.ts` — vitest hook test.
- Create `src/components/retainers/HoursUsedCell.tsx` — pure presentational cell: `used / targeth` + RAG bar, or `—`.
- Create `src/components/retainers/HoursUsedCell.test.tsx` — vitest render test.
- Modify `src/pages/RetainersList.tsx` — add Hours used column, per-row sync icon, header "Sync all".
- Create `src/pages/RetainersList.test.tsx` — vitest interaction test for the sync controls.

---

## Task 1: Backend pure logic — collectProvisionedActuals

**Files:**
- Create: `supabase/functions/_shared/retainer-actuals-logic.ts`
- Test: `supabase/functions/_shared/retainer-actuals-logic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/retainer-actuals-logic.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { collectProvisionedActuals } from "./retainer-actuals-logic.ts";

const today = "2026-06-09";

Deno.test("includes current-period task not already tracked, derives planned_hours", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "2026-06-01", period_end: "2026-06-30", points_per_occurrence: 2 }],
    today,
  );
  assertEquals(out, [{ clickup_task_id: "t1", dept_id: null, planned_hours: 0.5 }]);
});

Deno.test("excludes tasks already in project_actuals_current", () => {
  const out = collectProvisionedActuals(
    new Set<string>(["t1"]),
    [{ clickup_task_ids: ["t1", "t2"], period_start: "2026-06-01", period_end: "2026-06-30", points_per_occurrence: 4 }],
    today,
  );
  assertEquals(out.map((a) => a.clickup_task_id), ["t2"]);
});

Deno.test("dedupes a task id repeated across rows", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [
      { clickup_task_ids: ["t1"], period_start: "2026-06-01", period_end: "2026-06-30", points_per_occurrence: 1 },
      { clickup_task_ids: ["t1"], period_start: "2026-06-01", period_end: "2026-06-30", points_per_occurrence: 1 },
    ],
    today,
  );
  assertEquals(out.length, 1);
});

Deno.test("excludes rows whose period does not cover today", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "2026-07-01", period_end: "2026-07-31", points_per_occurrence: 2 }],
    today,
  );
  assertEquals(out, []);
});

Deno.test("planned_hours is 0 when points are null", () => {
  const out = collectProvisionedActuals(
    new Set<string>(),
    [{ clickup_task_ids: ["t1"], period_start: "2026-06-01", period_end: "2026-06-30", points_per_occurrence: null }],
    today,
  );
  assertEquals(out[0].planned_hours, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/retainer-actuals-logic.test.ts`
Expected: FAIL — module `./retainer-actuals-logic.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/_shared/retainer-actuals-logic.ts`:

```ts
// Pure logic for folding retainer provisioned tasks into the actuals sync.
// No Deno/Supabase imports — unit-testable in isolation.

export interface ProvisionedPeriodRow {
  clickup_task_ids: string[];
  period_start: string; // ISO date, inclusive
  period_end: string;   // ISO date, inclusive
  points_per_occurrence: number | null;
}

export interface SyntheticActual {
  clickup_task_id: string;
  dept_id: null;
  planned_hours: number;
}

const MIN_PER_POINT = 15; // 1 sprint point = 15 minutes (see Phase 8 provisioner)

/**
 * From a retainer's provisioned_tasks rows, produce the project_actuals seed
 * entries for tasks whose period covers `today` and that aren't already tracked
 * in project_actuals_current. Deduped across rows.
 *
 * planned_hours is derived from the recurring service's points and is
 * informational only — retainer burn uses projects.retainer_hours_target,
 * not per-task planned_hours.
 */
export function collectProvisionedActuals(
  existingTaskIds: Set<string>,
  rows: ProvisionedPeriodRow[],
  today: string,
): SyntheticActual[] {
  const out: SyntheticActual[] = [];
  const seen = new Set<string>(existingTaskIds);
  for (const row of rows) {
    if (today < row.period_start || today > row.period_end) continue;
    const plannedHours = ((row.points_per_occurrence ?? 0) * MIN_PER_POINT) / 60;
    for (const taskId of row.clickup_task_ids ?? []) {
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      out.push({ clickup_task_id: taskId, dept_id: null, planned_hours: plannedHours });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/retainer-actuals-logic.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/retainer-actuals-logic.ts supabase/functions/_shared/retainer-actuals-logic.test.ts
git commit -m "feat(sync): pure logic to fold retainer provisioned tasks into actuals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire provisioned tasks into sync-clickup-actuals + deploy

**Files:**
- Modify: `supabase/functions/sync-clickup-actuals/index.ts`

No new unit test (integration wiring; the pure logic is covered by Task 1). Verified by deploy + a live force-sync.

- [ ] **Step 1: Import the pure function**

At the top of `supabase/functions/sync-clickup-actuals/index.ts`, after the existing `_shared` imports (around line 23), add:

```ts
import { collectProvisionedActuals } from "../_shared/retainer-actuals-logic.ts";
```

- [ ] **Step 2: Bulk-fetch provisioned tasks for the projects being synced**

Immediately after the `actualsByProject` population block (after the closing `}` of the `if (projectIds.length > 0) { ... }` block that fills `actualsByProject`, around line 83), insert:

```ts
    // Phase 8: retainer provisioned tasks are recorded in provisioned_tasks but
    // never seeded into project_actuals, so their ClickUp time never enters the
    // burn pipeline. Pull the current-period task IDs here and fold them into
    // each project's actuals set below. First sync inserts a project_actuals
    // row; later syncs carry them forward via project_actuals_current.
    type ProvRow = {
      clickup_task_ids: string[] | null;
      period_start: string;
      period_end: string;
      retainer_recurring_services: { points_per_occurrence: number } | null;
    };
    const provisionedByProject = new Map<
      string,
      Array<{ clickup_task_ids: string[]; period_start: string; period_end: string; points_per_occurrence: number | null }>
    >();
    if (projectIds.length > 0) {
      const { data: provisioned } = await supabase
        // deno-lint-ignore no-explicit-any
        .from("provisioned_tasks" as any)
        .select(
          "project_id, clickup_task_ids, period_start, period_end, retainer_recurring_services(points_per_occurrence)",
        )
        .in("project_id", projectIds);
      for (const row of (provisioned ?? []) as Array<ProvRow & { project_id: string }>) {
        const list = provisionedByProject.get(row.project_id) ?? [];
        list.push({
          clickup_task_ids: row.clickup_task_ids ?? [],
          period_start: row.period_start,
          period_end: row.period_end,
          points_per_occurrence: row.retainer_recurring_services?.points_per_occurrence ?? null,
        });
        provisionedByProject.set(row.project_id, list);
      }
    }
    const todayIso = new Date().toISOString().slice(0, 10);
```

- [ ] **Step 3: Fold provisioned tasks into each project's actuals**

In the per-project loop, replace the existing line:

```ts
      const actuals = actualsByProject.get(p.id) ?? [];
```

with:

```ts
      const actuals = actualsByProject.get(p.id) ?? [];

      // Fold in current-period retainer provisioned tasks not already tracked.
      const existingTaskIds = new Set(actuals.map((a) => a.clickup_task_id));
      for (const seed of collectProvisionedActuals(
        existingTaskIds,
        provisionedByProject.get(p.id) ?? [],
        todayIso,
      )) {
        actuals.push({ ...seed, project_id: p.id });
      }
```

(The existing `for (const a of actuals)` loop below now fetches time entries and inserts a `project_actuals` row for each seeded task — `a.dept_id` is `null` and `a.planned_hours` the derived value, both valid columns.)

- [ ] **Step 4: Typecheck the function locally**

Run: `deno check supabase/functions/sync-clickup-actuals/index.ts`
Expected: no errors (the `as any` on `.from("provisioned_tasks")` mirrors the existing `project_actuals_current` cast).

- [ ] **Step 5: Run the full backend logic test suite**

Run: `deno test supabase/functions/_shared/retainer-actuals-logic.test.ts`
Expected: PASS.

- [ ] **Step 6: Deploy the function**

Run:
```bash
unset SUPABASE_ACCESS_TOKEN
supabase functions deploy sync-clickup-actuals --project-ref lpgwxacoqiqpcfpkklib
```
Expected: `Deployed Functions on project lpgwxacoqiqpcfpkklib: sync-clickup-actuals`.

- [ ] **Step 7: Verify live against the Test Conductor retainer**

Get the project id and force-sync it, then confirm a `project_actuals` row appeared for the provisioned task:
```bash
REF=lpgwxacoqiqpcfpkklib
ANON=$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env.local | sed -E 's/^[^=]+=//')
PID=$(curl -s -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "https://$REF.supabase.co/rest/v1/projects?engagement_type=eq.retainer&name=eq.Test%20Conductor%20retainer&select=id" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST "https://$REF.supabase.co/functions/v1/sync-clickup-actuals" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" -H "Content-Type: application/json" \
  --data "{\"project_id\":\"$PID\"}"
```
Expected: JSON like `{"inserted":N,...}` with N ≥ 1, no `error`. (Functional confirmation; the column is wired in Task 5.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/sync-clickup-actuals/index.ts
git commit -m "feat(sync): fold retainer provisioned tasks into project_actuals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: useSyncActuals hook

**Files:**
- Create: `src/hooks/useSyncActuals.ts`
- Test: `src/hooks/useSyncActuals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useSyncActuals.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

import { useSyncActuals } from "./useSyncActuals";

let invalidateSpy: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateSpy = vi.fn();
  qc.invalidateQueries = invalidateSpy;
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useSyncActuals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes with a project_id when given one", async () => {
    mockInvoke.mockResolvedValue({ data: { inserted: 1 }, error: null });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("proj-1");
    });
    expect(mockInvoke).toHaveBeenCalledWith("sync-clickup-actuals", { body: { project_id: "proj-1" } });
  });

  it("invokes with an empty body when no id is given (sync all)", async () => {
    mockInvoke.mockResolvedValue({ data: { inserted: 3 }, error: null });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(undefined);
    });
    expect(mockInvoke).toHaveBeenCalledWith("sync-clickup-actuals", { body: {} });
  });

  it("invalidates retainers and pulseRetainerBurn on success", async () => {
    mockInvoke.mockResolvedValue({ data: { inserted: 1 }, error: null });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("proj-1");
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["retainers"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["pulseRetainerBurn"] });
  });

  it("throws on transport error", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error("network down") });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync("proj-1");
      }),
    ).rejects.toThrow("network down");
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("throws when the response body carries an error", async () => {
    mockInvoke.mockResolvedValue({ data: { error: "clickup disabled" }, error: null });
    const { result } = renderHook(() => useSyncActuals(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync("proj-1");
      }),
    ).rejects.toThrow("clickup disabled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useSyncActuals.test.ts`
Expected: FAIL — cannot find module `./useSyncActuals`.

- [ ] **Step 3: Write minimal implementation**

Create `src/hooks/useSyncActuals.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Force-syncs ClickUp actuals. Pass a projectId to sync one retainer/project;
// omit it to sync all in-progress projects. Refreshes the retainers list and
// the retainer burn used by the Hours-used column.
export function useSyncActuals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId?: string): Promise<void> => {
      const { data, error } = await supabase.functions.invoke("sync-clickup-actuals", {
        body: projectId ? { project_id: projectId } : {},
      });
      if (error) throw error;
      const body = data as { error?: string } | null;
      if (body?.error) throw new Error(body.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retainers"] });
      qc.invalidateQueries({ queryKey: ["pulseRetainerBurn"] });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useSyncActuals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSyncActuals.ts src/hooks/useSyncActuals.test.ts
git commit -m "feat(retainers): useSyncActuals mutation hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: HoursUsedCell component

**Files:**
- Create: `src/components/retainers/HoursUsedCell.tsx`
- Test: `src/components/retainers/HoursUsedCell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/retainers/HoursUsedCell.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoursUsedCell } from "./HoursUsedCell";
import type { RetainerBurnRow } from "@/types/pulse";

const burn: RetainerBurnRow = {
  projectId: "p1",
  clientName: "Test Conductor",
  feePerMonthCents: 1000000,
  hoursTarget: 10,
  hoursUsed: 2,
  burnPct: 20,
  daysLeftInMonth: 21,
  effectiveHourlyRateCents: 100000,
  projectedHours: 6,
  isOverrunRisk: false,
  isUnderutilised: false,
  rag: "green",
};

describe("HoursUsedCell", () => {
  it("renders used / target and a bar when burn data is present", () => {
    const { container } = render(<HoursUsedCell burn={burn} />);
    expect(screen.getByText("2 / 10h")).toBeInTheDocument();
    expect(container.querySelector(".bg-green-500")).toBeTruthy();
  });

  it("renders an em dash when there is no burn data", () => {
    render(<HoursUsedCell burn={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("uses the red bar colour at high burn", () => {
    const { container } = render(<HoursUsedCell burn={{ ...burn, burnPct: 92, rag: "red" }} />);
    expect(container.querySelector(".bg-m-error")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/retainers/HoursUsedCell.test.tsx`
Expected: FAIL — cannot find module `./HoursUsedCell`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/retainers/HoursUsedCell.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { RetainerBurnRow } from "@/types/pulse";

const barColor: Record<RetainerBurnRow["rag"], string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red: "bg-m-error",
};

// Current-month hours consumed vs target with a thin RAG burn bar.
// `burn` is null for retainers with no target / no burn data → renders "—".
export function HoursUsedCell({ burn }: { burn: RetainerBurnRow | null }) {
  if (!burn) {
    return <span className="text-body-medium text-m-on-surface-variant">—</span>;
  }
  return (
    <div className="min-w-[7rem]">
      <div className="mb-1 text-body-medium tabular-nums text-m-on-surface">
        {burn.hoursUsed} / {burn.hoursTarget}h
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-m-surface-container-high">
        <div
          className={cn("h-full rounded-full transition-all", barColor[burn.rag])}
          style={{ width: `${Math.min(burn.burnPct, 100)}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/retainers/HoursUsedCell.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/retainers/HoursUsedCell.tsx src/components/retainers/HoursUsedCell.test.tsx
git commit -m "feat(retainers): HoursUsedCell with RAG burn bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire column + sync controls into RetainersList

**Files:**
- Modify: `src/pages/RetainersList.tsx`
- Test: `src/pages/RetainersList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pages/RetainersList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { RetainerBurnRow } from "@/types/pulse";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSyncMutate = vi.hoisted(() => vi.fn());
const mockDeleteMutate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("@/hooks/useRetainers", () => ({
  useRetainers: () => ({
    data: [
      {
        id: "p1",
        name: "Test Conductor retainer",
        status: "in_progress",
        retainer_hours_target: 10,
        retainer_monthly_fee_cents: 1000000,
        started_at: null,
        client_name: "Test Conductor",
      },
    ],
  }),
  useDeleteRetainer: () => ({ mutate: mockDeleteMutate, isPending: false }),
}));
const burnRow: RetainerBurnRow = {
  projectId: "p1", clientName: "Test Conductor", feePerMonthCents: 1000000,
  hoursTarget: 10, hoursUsed: 2, burnPct: 20, daysLeftInMonth: 21,
  effectiveHourlyRateCents: 100000, projectedHours: 6,
  isOverrunRisk: false, isUnderutilised: false, rag: "green",
};
vi.mock("@/hooks/usePulseRetainerBurn", () => ({
  usePulseRetainerBurn: () => [burnRow],
}));
vi.mock("@/hooks/useSyncActuals", () => ({
  useSyncActuals: () => ({ mutate: mockSyncMutate, isPending: false, variables: undefined }),
}));

import { RetainersList } from "./RetainersList";

describe("RetainersList sync controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows hours consumed for the retainer", () => {
    render(<RetainersList />);
    expect(screen.getByText("2 / 10h")).toBeInTheDocument();
  });

  it("per-row sync invokes with the project id and does not navigate", async () => {
    render(<RetainersList />);
    await userEvent.click(screen.getByLabelText("Sync Test Conductor retainer"));
    expect(mockSyncMutate).toHaveBeenCalled();
    expect(mockSyncMutate.mock.calls[0][0]).toBe("p1");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("header Sync all invokes with no project id", async () => {
    render(<RetainersList />);
    await userEvent.click(screen.getByRole("button", { name: /sync all/i }));
    expect(mockSyncMutate).toHaveBeenCalled();
    expect(mockSyncMutate.mock.calls[0][0]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/RetainersList.test.tsx`
Expected: FAIL — no "2 / 10h" text / no "Sync all" button / no sync label yet.

- [ ] **Step 3: Update the imports in `src/pages/RetainersList.tsx`**

Replace the top import block (lines 1–17) with:

```tsx
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRetainers, useDeleteRetainer } from "@/hooks/useRetainers";
import { usePulseRetainerBurn } from "@/hooks/usePulseRetainerBurn";
import { useSyncActuals } from "@/hooks/useSyncActuals";
import { HoursUsedCell } from "@/components/retainers/HoursUsedCell";
import { formatZar, cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/project-status";
```

- [ ] **Step 4: Add hooks + burn map inside the component**

Right after `const deleteRetainer = useDeleteRetainer();` (line ~26), add:

```tsx
  const burnRows = usePulseRetainerBurn();
  const sync = useSyncActuals();
  const burnByProject = useMemo(
    () => new Map(burnRows.map((b) => [b.projectId, b])),
    [burnRows],
  );

  function handleSync(projectId?: string, label?: string) {
    sync.mutate(projectId, {
      onSuccess: () => toast.success(label ? `Synced ${label}` : "Synced all retainers"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Sync failed"),
    });
  }
```

- [ ] **Step 5: Add the "Sync all" header button**

Replace the header action (the single `<Button onClick={() => navigate("/retainers/new")}>…</Button>`, lines ~32–35) with:

```tsx
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => handleSync(undefined)}
            disabled={sync.isPending}
          >
            <RefreshCw
              className={cn("h-4 w-4", sync.isPending && sync.variables === undefined && "animate-spin")}
            />
            Sync all
          </Button>
          <Button onClick={() => navigate("/retainers/new")}>
            <Plus className="h-4 w-4" />
            New retainer
          </Button>
        </div>
```

- [ ] **Step 6: Add the "Hours used" column header**

In `<TableHeader>`, insert a new `<TableHead>` between the Hours target and Status heads:

```tsx
                  <TableHead className="text-right">Hours target</TableHead>
                  <TableHead>Hours used</TableHead>
                  <TableHead>Status</TableHead>
```

- [ ] **Step 7: Add the Hours-used cell**

In the row body, between the Hours target `<TableCell>` and the Status `<TableCell>`, insert:

```tsx
                    <TableCell>
                      <HoursUsedCell burn={burnByProject.get(r.id) ?? null} />
                    </TableCell>
```

- [ ] **Step 8: Add the per-row sync icon**

In the actions `<TableCell className="text-right">`, add the sync button immediately before the existing delete `<Button>`:

```tsx
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={sync.isPending}
                        aria-label={`Sync ${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSync(r.id, r.name);
                        }}
                      >
                        <RefreshCw
                          className={cn("h-4 w-4", sync.isPending && sync.variables === r.id && "animate-spin")}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={deleteRetainer.isPending}
                        aria-label={`Delete retainer ${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            confirm(
                              `Delete "${r.name}" for ${r.client_name}? This removes the retainer and its recurring services. The ClickUp list is left untouched.`,
                            )
                          ) {
                            deleteRetainer.mutate(r.id, {
                              onSuccess: () => toast.success("Retainer deleted"),
                              onError: (err) =>
                                toast.error(
                                  err instanceof Error ? err.message : "Failed to delete retainer",
                                ),
                            });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
```

- [ ] **Step 9: Run the page test to verify it passes**

Run: `npx vitest run src/pages/RetainersList.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add src/pages/RetainersList.tsx src/pages/RetainersList.test.tsx
git commit -m "feat(retainers): hours-used column + per-row and Sync-all controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole frontend test suite**

Run: `npm test`
Expected: PASS, including the three new test files.

- [ ] **Step 2: Run the backend logic tests**

Run: `deno test supabase/functions/_shared/retainer-actuals-logic.test.ts`
Expected: PASS.

- [ ] **Step 3: Manual e2e against the live app**

Open the Retainers page (`npm run dev`, port 5391). For "Test Conductor retainer":
- the Hours used column shows `0 / 10h` (green) before syncing;
- click the row's sync icon — it spins, toasts "Synced Test Conductor retainer";
- the column updates to `2 / 10h` (matching the 2h tracked on "Brendan — recurring on 2026-06-01").

Expected: the consumed hours appear after sync. If they don't, re-check Task 2 Step 7's live force-sync output for an `error`.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(retainers): verification fixes for hours-used + sync

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes / non-blocking

- `src/types/db.ts` is stale — it predates the Phase 8 tables (`provisioned_tasks`, `retainer_recurring_services`). This feature doesn't need them on the frontend (the page reads `projects` + `project_actuals_current` via `usePulseRetainerBurn`; the backend casts `as any`). Regenerating db types is a separate cleanup, out of scope here.
- "Sync all" syncs all in-progress projects (a superset of retainers), matching the cron — intentional.
