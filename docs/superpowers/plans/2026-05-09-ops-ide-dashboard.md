# Ops IDE Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stat-card Dashboard with a VS Code-style project-first operations IDE — client/project tree on the left, aggregate ops summary or project detail on the right.

**Architecture:** Standalone `DashboardShell` renders at the `/` route outside `AppShell`, owning a 3-column grid (icon rail + 240px project tree + flex detail panel). `AppShell` loses its sidebar column, becoming a 2-column grid for all other routes. State (`selectedProjectId`, `hiddenIds`) lives in `DashboardShell` and flows down.

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn/ui, TanStack Query, React Router v6, Vitest + Testing Library.

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/hooks/useHiddenProjects.ts` | Session-only Set of dismissed project ids |
| Create | `src/hooks/useHiddenProjects.test.ts` | Tests |
| Create | `src/hooks/useOpsOverview.ts` | Derive health counts + attention/recent lists from ClientWithProjects[] |
| Create | `src/hooks/useOpsOverview.test.ts` | Tests |
| Create | `src/components/dashboard/DashboardProjectRow.tsx` | Button-based project row for the tree (no Link — clicking sets selected state) |
| Create | `src/components/dashboard/DashboardProjectRow.test.tsx` | Tests |
| Create | `src/components/dashboard/RecommendedBanner.tsx` | Amber action strip shown above tabs when project has issues |
| Create | `src/components/dashboard/RecommendedBanner.test.tsx` | Tests |
| Create | `src/components/dashboard/DashboardProjectView.tsx` | Selected project panel: header + RecommendedBanner + tabs + StatusStrip |
| Create | `src/components/dashboard/OpsOverview.tsx` | Default right panel: health cards + needs-attention + recently-active |
| Create | `src/components/dashboard/ProjectTree.tsx` | Left panel: health pills + filter + client groups + DashboardProjectRow |
| Create | `src/components/dashboard/DashboardShell.tsx` | Full IDE layout; owns selectedProjectId + hiddenIds state |
| Create | `src/pages/DashboardPage.tsx` | Thin route component rendering DashboardShell |
| Modify | `src/App.tsx` | Add DashboardPage outside AppShell; all other routes stay in AppShell |
| Modify | `src/components/AppShell.tsx` | Remove aside sidebar column; grid → `grid-cols-[56px_1fr]` |

> **Why `DashboardProjectRow` instead of extending `ProjectNavRow`:** `ProjectNavRow` renders as a `<Link>` and uses `useMatch` for active state — both wrong for the dashboard where rows set React state and don't navigate. A separate button-based component is cleaner than adding mode-switching to an existing component.

---

## Task 1: `useHiddenProjects` hook

**Files:**
- Create: `src/hooks/useHiddenProjects.ts`
- Create: `src/hooks/useHiddenProjects.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/hooks/useHiddenProjects.test.ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHiddenProjects } from "./useHiddenProjects";

describe("useHiddenProjects", () => {
  it("starts with no hidden ids", () => {
    const { result } = renderHook(() => useHiddenProjects());
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it("hides a project by id", () => {
    const { result } = renderHook(() => useHiddenProjects());
    act(() => result.current.hide("proj-1"));
    expect(result.current.isHidden("proj-1")).toBe(true);
  });

  it("does not affect other ids when hiding one", () => {
    const { result } = renderHook(() => useHiddenProjects());
    act(() => result.current.hide("proj-1"));
    expect(result.current.isHidden("proj-2")).toBe(false);
  });

  it("hiding the same id twice is idempotent", () => {
    const { result } = renderHook(() => useHiddenProjects());
    act(() => {
      result.current.hide("proj-1");
      result.current.hide("proj-1");
    });
    expect(result.current.hiddenIds.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/brendangunn/Github/cc-service-calculator && npx vitest run src/hooks/useHiddenProjects.test.ts
```

Expected: `Cannot find module './useHiddenProjects'`

- [ ] **Step 3: Implement the hook**

```typescript
// src/hooks/useHiddenProjects.ts
import { useState } from "react";

export function useHiddenProjects() {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const hide = (id: string) =>
    setHiddenIds((prev) => new Set([...prev, id]));

  const isHidden = (id: string) => hiddenIds.has(id);

  return { hiddenIds, hide, isHidden };
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/hooks/useHiddenProjects.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useHiddenProjects.ts src/hooks/useHiddenProjects.test.ts
git commit -m "feat(dashboard): add useHiddenProjects hook"
```

---

## Task 2: `useOpsOverview` hook

**Files:**
- Create: `src/hooks/useOpsOverview.ts`
- Create: `src/hooks/useOpsOverview.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/hooks/useOpsOverview.test.ts
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOpsOverview } from "./useOpsOverview";
import type { ClientWithProjects } from "./useClientProjects";

const makeProject = (overrides: Partial<{
  id: string; name: string; status: string;
  scope_status: string; engagement_type: string;
  started_at: string; client_id: string;
}>) => ({
  id: "proj-1",
  name: "Test Project",
  status: "in_progress",
  scope_status: "on_track",
  engagement_type: "fixed",
  started_at: "2026-04-01T00:00:00Z",
  client_id: "client-1",
  project_code: "T-001",
  quote_id: null,
  created_at: "2026-04-01T00:00:00Z",
  ...overrides,
} as any);

const makeClient = (projects: ReturnType<typeof makeProject>[]): ClientWithProjects => ({
  id: "client-1",
  name: "ACME",
  primary_domain: "acme.co.za",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  projects,
} as any);

describe("useOpsOverview", () => {
  it("returns zero counts for empty data", () => {
    const { result } = renderHook(() => useOpsOverview([]));
    expect(result.current.onTrackCount).toBe(0);
    expect(result.current.needsAttentionCount).toBe(0);
    expect(result.current.overdueCount).toBe(0);
    expect(result.current.totalActiveProjects).toBe(0);
    expect(result.current.totalActiveClients).toBe(0);
  });

  it("counts on_track projects", () => {
    const data = [makeClient([makeProject({ scope_status: "on_track" })])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.onTrackCount).toBe(1);
  });

  it("counts needs_attention projects", () => {
    const data = [makeClient([makeProject({ scope_status: "needs_attention" })])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.needsAttentionCount).toBe(1);
  });

  it("counts overdue projects", () => {
    const data = [makeClient([makeProject({ scope_status: "overdue" })])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.overdueCount).toBe(1);
  });

  it("excludes completed projects from counts", () => {
    const data = [makeClient([makeProject({ status: "completed" })])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.totalActiveProjects).toBe(0);
  });

  it("puts overdue projects before needs_attention in attentionProjects", () => {
    const data = [makeClient([
      makeProject({ id: "p1", scope_status: "needs_attention" }),
      makeProject({ id: "p2", scope_status: "overdue" }),
    ])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.attentionProjects[0].id).toBe("p2");
  });

  it("includes clientName in each OpsProject", () => {
    const data = [makeClient([makeProject({})])];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.recentProjects[0].clientName).toBe("ACME");
  });

  it("counts active clients correctly", () => {
    const data = [
      makeClient([makeProject({ id: "p1", client_id: "client-1" })]),
      { ...makeClient([]), id: "client-2", name: "Empty Client", projects: [] } as any,
    ];
    const { result } = renderHook(() => useOpsOverview(data));
    expect(result.current.totalActiveClients).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/hooks/useOpsOverview.test.ts
```

Expected: `Cannot find module './useOpsOverview'`

- [ ] **Step 3: Implement the hook**

```typescript
// src/hooks/useOpsOverview.ts
import { useMemo } from "react";
import type { ClientWithProjects } from "./useClientProjects";

export type OpsProject = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  scopeStatus: string;
  engagementType: string;
  startedAt: string;
};

export type OpsOverviewData = {
  totalActiveProjects: number;
  totalActiveClients: number;
  onTrackCount: number;
  needsAttentionCount: number;
  overdueCount: number;
  attentionProjects: OpsProject[];
  recentProjects: OpsProject[];
};

export function useOpsOverview(clientsData: ClientWithProjects[]): OpsOverviewData {
  return useMemo(() => {
    const activeProjects: OpsProject[] = clientsData.flatMap((c) =>
      c.projects
        .filter((p) => p.status === "in_progress")
        .map((p) => ({
          id: p.id,
          name: p.name ?? "Untitled",
          clientId: c.id,
          clientName: c.name,
          scopeStatus: p.scope_status ?? "on_track",
          engagementType: p.engagement_type ?? "fixed",
          startedAt: p.started_at,
        }))
    );

    const onTrackCount = activeProjects.filter((p) => p.scopeStatus === "on_track").length;
    const needsAttentionCount = activeProjects.filter((p) => p.scopeStatus === "needs_attention").length;
    const overdueCount = activeProjects.filter((p) => p.scopeStatus === "overdue").length;

    const attentionProjects = activeProjects
      .filter((p) => p.scopeStatus === "needs_attention" || p.scopeStatus === "overdue")
      .sort((a, b) => (a.scopeStatus === "overdue" ? -1 : b.scopeStatus === "overdue" ? 1 : 0));

    const recentProjects = activeProjects
      .filter((p) => p.scopeStatus === "on_track")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 5);

    const totalActiveClients = clientsData.filter((c) =>
      c.projects.some((p) => p.status === "in_progress")
    ).length;

    return {
      totalActiveProjects: activeProjects.length,
      totalActiveClients,
      onTrackCount,
      needsAttentionCount,
      overdueCount,
      attentionProjects,
      recentProjects,
    };
  }, [clientsData]);
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/hooks/useOpsOverview.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOpsOverview.ts src/hooks/useOpsOverview.test.ts
git commit -m "feat(dashboard): add useOpsOverview derived-data hook"
```

---

## Task 3: `DashboardProjectRow` component

Button-based project row for the project tree. Does not navigate — calls `onSelect`. Shows a dismiss `✓` on hover.

**Files:**
- Create: `src/components/dashboard/DashboardProjectRow.tsx`
- Create: `src/components/dashboard/DashboardProjectRow.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/dashboard/DashboardProjectRow.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { DashboardProjectRow } from "./DashboardProjectRow";

const baseProps = {
  id: "proj-1",
  name: "Google Ads Q2",
  engagementType: "retainer",
  scopeStatus: "on_track",
  isSelected: false,
  onSelect: vi.fn(),
  onHide: vi.fn(),
};

describe("DashboardProjectRow", () => {
  it("renders the project name", () => {
    render(<DashboardProjectRow {...baseProps} />);
    expect(screen.getByText("Google Ads Q2")).toBeInTheDocument();
  });

  it("renders the engagement type badge", () => {
    render(<DashboardProjectRow {...baseProps} />);
    expect(screen.getByText("retainer")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<DashboardProjectRow {...baseProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Google Ads Q2/i }));
    expect(onSelect).toHaveBeenCalledWith("proj-1");
  });

  it("shows green dot for on_track", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="on_track" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("bg-green-500");
  });

  it("shows amber dot for needs_attention", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="needs_attention" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("bg-amber-400");
  });

  it("shows red dot for overdue", () => {
    render(<DashboardProjectRow {...baseProps} scopeStatus="overdue" />);
    expect(screen.getByTestId("status-dot")).toHaveClass("bg-red-500");
  });

  it("applies selected styles when isSelected=true", () => {
    render(<DashboardProjectRow {...baseProps} isSelected />);
    expect(screen.getByRole("button", { name: /Google Ads Q2/i })).toHaveClass("bg-m-primary-container");
  });

  it("calls onHide when dismiss button is clicked", () => {
    const onHide = vi.fn();
    render(<DashboardProjectRow {...baseProps} onHide={onHide} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onHide).toHaveBeenCalledWith("proj-1");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/components/dashboard/DashboardProjectRow.test.tsx
```

Expected: `Cannot find module './DashboardProjectRow'`

- [ ] **Step 3: Create the component**

```typescript
// src/components/dashboard/DashboardProjectRow.tsx
import { cn } from "@/lib/utils";

const statusDot: Record<string, string> = {
  on_track: "bg-green-500",
  needs_attention: "bg-amber-400",
  overdue: "bg-red-500",
};

interface Props {
  id: string;
  name: string;
  engagementType: string;
  scopeStatus: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
}

export function DashboardProjectRow({ id, name, engagementType, scopeStatus, isSelected, onSelect, onHide }: Props) {
  return (
    <div className="group relative">
      <button
        aria-label={name}
        onClick={() => onSelect(id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-label-medium transition-colors text-left",
          isSelected
            ? "bg-m-primary-container text-m-on-primary-container"
            : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
        )}
      >
        <span
          data-testid="status-dot"
          className={cn("h-2 w-2 shrink-0 rounded-full", statusDot[scopeStatus] ?? "bg-gray-400")}
        />
        <span className="flex-1 truncate">{name}</span>
        <span className="shrink-0 rounded px-1 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
          {engagementType}
        </span>
      </button>

      <button
        aria-label="dismiss"
        onClick={(e) => { e.stopPropagation(); onHide(id); }}
        className="absolute right-8 top-1/2 -translate-y-1/2 hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-[10px] text-m-on-surface-variant hover:bg-m-surface-container-high"
      >
        ✓
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/components/dashboard/DashboardProjectRow.test.tsx
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/DashboardProjectRow.tsx src/components/dashboard/DashboardProjectRow.test.tsx
git commit -m "feat(dashboard): add DashboardProjectRow component"
```

---

## Task 4: `RecommendedBanner` component

Amber strip shown above tabs when a project has actionable issues. Derives messages from actuals, project, and activity event data.

**Files:**
- Create: `src/components/dashboard/RecommendedBanner.tsx`
- Create: `src/components/dashboard/RecommendedBanner.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/dashboard/RecommendedBanner.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecommendedBanner } from "./RecommendedBanner";

const baseProject = {
  id: "proj-1",
  scope_status: "on_track",
  quote_id: "quote-1",
} as any;

const baseActuals = [
  { actual_hours: 20, planned_hours: 100, dept_id: "d1", id: "a1" } as any,
];

const baseEvents: any[] = [];

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("RecommendedBanner", () => {
  it("renders nothing when no conditions are met", () => {
    const { container } = wrap(
      <RecommendedBanner
        project={baseProject}
        actuals={baseActuals}
        events={baseEvents}
        onDismiss={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows budget warning when burn >= 80%", () => {
    const actuals = [{ actual_hours: 85, planned_hours: 100, dept_id: "d1", id: "a1" } as any];
    wrap(<RecommendedBanner project={baseProject} actuals={actuals} events={baseEvents} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Budget at 85%/)).toBeInTheDocument();
  });

  it("shows no-quote warning when quote_id is null", () => {
    wrap(
      <RecommendedBanner
        project={{ ...baseProject, quote_id: null }}
        actuals={baseActuals}
        events={baseEvents}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(/No quote linked/)).toBeInTheDocument();
  });

  it("shows overdue warning when scope_status is overdue", () => {
    wrap(
      <RecommendedBanner
        project={{ ...baseProject, scope_status: "overdue" }}
        actuals={baseActuals}
        events={baseEvents}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(/Project is overdue/)).toBeInTheDocument();
  });

  it("shows quote-not-accepted when latest quote event is sent", () => {
    const events = [{ type: "quote", id: "q1", timestamp: "2026-05-01", quote: { id: "q1", status: "sent", total_cents: 5000 } }] as any;
    wrap(<RecommendedBanner project={baseProject} actuals={baseActuals} events={events} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Quote not yet accepted/)).toBeInTheDocument();
  });

  it("calls onDismiss when × button is clicked", () => {
    const onDismiss = vi.fn();
    const actuals = [{ actual_hours: 85, planned_hours: 100, dept_id: "d1", id: "a1" } as any];
    wrap(<RecommendedBanner project={baseProject} actuals={actuals} events={baseEvents} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/components/dashboard/RecommendedBanner.test.tsx
```

Expected: `Cannot find module './RecommendedBanner'`

- [ ] **Step 3: Implement the component**

```typescript
// src/components/dashboard/RecommendedBanner.tsx
import { Link } from "react-router-dom";
import type { Database } from "@/types/db";
import type { ActivityEvent } from "@/hooks/useProjectActivity";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type ActualRow = Database["public"]["Views"]["project_actuals_current"]["Row"];

interface Props {
  project: Project;
  actuals: ActualRow[];
  events: ActivityEvent[];
  onDismiss: () => void;
}

export function RecommendedBanner({ project, actuals, events, onDismiss }: Props) {
  const messages: string[] = [];
  let quoteAction: { label: string; to: string } | null = null;

  const totalActual = actuals.reduce((s, a) => s + (a.actual_hours ?? 0), 0);
  const totalPlanned = actuals.reduce((s, a) => s + (a.planned_hours ?? 0), 0);
  const burnPct = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;

  if (burnPct >= 80) messages.push(`Budget at ${burnPct}% — consider scoping additional hours`);

  if (!project.quote_id) {
    messages.push("No quote linked to this project");
  } else {
    const quoteEvent = events.find((e) => e.type === "quote");
    if (quoteEvent?.type === "quote") {
      const status = quoteEvent.quote.status as string;
      if (status === "draft" || status === "sent") {
        messages.push("Quote not yet accepted");
        if (status === "sent") {
          quoteAction = { label: "View quote →", to: `/quotes/${quoteEvent.quote.id}` };
        } else {
          quoteAction = { label: "Send quote →", to: `/quotes/${quoteEvent.quote.id}/send` };
        }
      }
    }
  }

  if (project.scope_status === "overdue") messages.push("Project is overdue");

  const briefEvents = events.filter((e) => e.type === "brief");
  if (briefEvents.length > 0) {
    const latest = briefEvents[0];
    const daysSince = Math.floor(
      (Date.now() - new Date(latest.timestamp).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSince >= 14) messages.push(`No brief activity in ${daysSince} days`);
  }

  if (messages.length === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-orange-200 bg-orange-50 px-4 py-2">
      <span className="text-label-small font-bold text-orange-700">⚡ Recommended</span>
      <span className="flex-1 text-label-small text-orange-800">{messages.join(" · ")}</span>
      {quoteAction && (
        <Link to={quoteAction.to} className="text-label-small text-orange-700 hover:underline">
          {quoteAction.label}
        </Link>
      )}
      <button
        aria-label="dismiss"
        onClick={onDismiss}
        className="text-label-small text-orange-500 hover:text-orange-700"
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/components/dashboard/RecommendedBanner.test.tsx
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/RecommendedBanner.tsx src/components/dashboard/RecommendedBanner.test.tsx
git commit -m "feat(dashboard): add RecommendedBanner component"
```

---

## Task 5: `DashboardProjectView` component

The right panel when a project is selected. Renders the project header with action buttons, `RecommendedBanner`, and the existing tabs + StatusStrip layout (same structure as `ProjectScopeView` minus the breadcrumb).

**Files:**
- Create: `src/components/dashboard/DashboardProjectView.tsx`

No dedicated test file — this component is an integration of already-tested pieces. Manual verification in the browser is the acceptance test (see Step 4).

- [ ] **Step 1: Check whether `NewBrief` reads `projectId` from query params**

```bash
grep -n "projectId\|useSearchParams\|searchParams" /Users/brendangunn/Github/cc-service-calculator/src/pages/NewBrief.tsx | head -20
```

If `projectId` is NOT read from query params, note it — the `+ Brief` button will still navigate to `/briefs/new` and the user can select the project manually. Do NOT modify `NewBrief.tsx` in this task; that's a separate enhancement.

- [ ] **Step 2: Implement `DashboardProjectView`**

```typescript
// src/components/dashboard/DashboardProjectView.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useProject, useUpdateProject } from "@/hooks/useProjects";
import { useProjectActivity } from "@/hooks/useProjectActivity";
import { ActivityFeed } from "@/components/scope/ActivityFeed";
import { StatusStrip } from "@/components/scope/StatusStrip";
import { RecommendedBanner } from "./RecommendedBanner";

const scopeStatusColor: Record<string, string> = {
  on_track: "bg-green-100 text-green-800",
  needs_attention: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
};

function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase.functions.invoke("sync-clickup-actuals", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      return data as { inserted?: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["clients", "withProjects"] });
      toast.success(`Synced — ${data?.inserted ?? 0} rows updated`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

interface Props {
  projectId: string;
  clientName: string;
  onComplete: () => void;
}

export function DashboardProjectView({ projectId, clientName, onComplete }: Props) {
  const navigate = useNavigate();
  const { data, isLoading } = useProject(projectId);
  const { data: events = [], isLoading: activityLoading } = useProjectActivity(
    projectId,
    data?.project.quote_id ?? undefined
  );
  const sync = useSyncNow();
  const updateProject = useUpdateProject();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-body-medium text-m-on-surface-variant">
        Loading…
      </div>
    );
  }

  if (!data) return null;

  const { project, actuals } = data;
  const quoteEvent = events.find((e) => e.type === "quote");
  const activeQuote = quoteEvent?.type === "quote" ? quoteEvent.quote : null;
  const briefCount = events.filter((e) => e.type === "brief").length;
  const scopeStatus = project.scope_status ?? "on_track";

  function handleComplete() {
    if (!window.confirm(`Mark "${project.name}" as complete?`)) return;
    updateProject.mutate(
      { id: projectId, patch: { status: "completed" } },
      {
        onSuccess: () => {
          toast.success("Project marked complete");
          onComplete();
        },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-m-outline-variant bg-m-surface px-5 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-label-small px-2 py-0.5 rounded bg-m-surface-container border border-m-outline-variant">
              {project.project_code}
            </span>
            <span className="text-title-medium text-m-on-surface">
              {project.name ?? "Untitled project"}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-label-small",
                scopeStatusColor[scopeStatus] ?? "bg-m-surface-container text-m-on-surface-variant"
              )}
            >
              {scopeStatus.replace(/_/g, " ")}
            </span>
          </div>
          <div className="mt-0.5 text-label-small text-m-on-surface-variant">
            {clientName} · {project.engagement_type ?? "fixed"} · Started{" "}
            {new Date(project.started_at).toLocaleDateString("en-ZA")}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/briefs/new`)}
          >
            + Brief
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => sync.mutate(projectId)}
            disabled={sync.isPending}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Syncing…" : "Sync"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleComplete}
            disabled={updateProject.isPending}
            className="text-green-700 border-green-300 hover:bg-green-50"
          >
            ✓ Complete
          </Button>
        </div>
      </div>

      {/* Recommended banner */}
      {!bannerDismissed && (
        <RecommendedBanner
          project={project}
          actuals={actuals}
          events={events}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/* Tabs + StatusStrip */}
      <div className="flex flex-1 overflow-hidden">
        <Tabs defaultValue="activity" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="shrink-0 justify-start rounded-none border-b border-m-outline-variant bg-m-surface px-5">
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="quote">Quote / SOW</TabsTrigger>
            <TabsTrigger value="time">Time</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="flex-1 overflow-auto">
            <ActivityFeed events={events} isLoading={activityLoading} />
          </TabsContent>

          <TabsContent value="tasks" className="flex-1 overflow-auto p-5">
            <p className="text-body-medium text-m-on-surface-variant">
              ClickUp task sync coming in a future phase.
            </p>
          </TabsContent>

          <TabsContent value="quote" className="flex-1 overflow-auto p-5">
            <p className="text-body-medium text-m-on-surface-variant">
              {project.quote_id
                ? `Linked to quote ${project.quote_id}.`
                : "No quote linked to this project yet."}
            </p>
          </TabsContent>

          <TabsContent value="time" className="flex-1 overflow-auto p-5">
            <p className="text-body-medium text-m-on-surface-variant">
              Time breakdown by department.
            </p>
          </TabsContent>
        </Tabs>

        <StatusStrip actuals={actuals} quote={activeQuote} briefCount={briefCount} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit 2>&1 | grep -i "DashboardProjectView\|RecommendedBanner" | head -20
```

Expected: no output (no errors for these files).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/DashboardProjectView.tsx
git commit -m "feat(dashboard): add DashboardProjectView panel"
```

---

## Task 6: `OpsOverview` component

The default right panel when no project is selected.

**Files:**
- Create: `src/components/dashboard/OpsOverview.tsx`

- [ ] **Step 1: Implement `OpsOverview`**

```typescript
// src/components/dashboard/OpsOverview.tsx
import { cn } from "@/lib/utils";
import type { OpsOverviewData, OpsProject } from "@/hooks/useOpsOverview";

const scopeStatusColor: Record<string, string> = {
  on_track: "bg-green-100 text-green-800",
  needs_attention: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
};

const scopeStatusDot: Record<string, string> = {
  on_track: "bg-green-500",
  needs_attention: "bg-amber-400",
  overdue: "bg-red-500",
};

interface ProjectRowProps {
  project: OpsProject;
  onSelect: (id: string) => void;
}

function OpsProjectRow({ project, onSelect }: ProjectRowProps) {
  return (
    <button
      onClick={() => onSelect(project.id)}
      className="flex w-full items-center gap-3 rounded-lg border border-m-outline-variant bg-m-surface px-4 py-3 text-left transition-colors hover:bg-m-surface-container"
    >
      <span
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full", scopeStatusDot[project.scopeStatus] ?? "bg-gray-400")}
      />
      <span className="flex-1 min-w-0">
        <span className="text-label-medium text-m-on-surface font-medium">{project.clientName}</span>
        <span className="mx-1 text-m-on-surface-variant">—</span>
        <span className="text-label-medium text-m-on-surface">{project.name}</span>
      </span>
      <span className={cn("shrink-0 rounded px-2 py-0.5 text-label-small", scopeStatusColor[project.scopeStatus] ?? "bg-m-surface-container text-m-on-surface-variant")}>
        {project.scopeStatus.replace(/_/g, " ")}
      </span>
      <span className="shrink-0 text-label-small text-m-on-surface-variant">{project.engagementType}</span>
    </button>
  );
}

interface Props {
  opsData: OpsOverviewData;
  onSelect: (id: string) => void;
}

export function OpsOverview({ opsData, onSelect }: Props) {
  const today = new Date().toLocaleDateString("en-ZA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-col gap-6 overflow-auto p-6">
      {/* Header */}
      <div>
        <h1 className="text-headline-small text-m-on-surface">Operations overview</h1>
        <p className="mt-1 text-body-small text-m-on-surface-variant">
          {today} · {opsData.totalActiveProjects} active project{opsData.totalActiveProjects !== 1 ? "s" : ""} across{" "}
          {opsData.totalActiveClients} client{opsData.totalActiveClients !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Health cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="text-display-small text-green-800">{opsData.onTrackCount}</div>
          <div className="mt-1 text-label-small font-semibold text-green-700">On track</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-display-small text-amber-800">{opsData.needsAttentionCount}</div>
          <div className="mt-1 text-label-small font-semibold text-amber-700">Needs attention</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-display-small text-red-800">{opsData.overdueCount}</div>
          <div className="mt-1 text-label-small font-semibold text-red-700">Overdue</div>
        </div>
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container p-4">
          <div className="text-display-small text-m-on-surface">{opsData.totalActiveProjects}</div>
          <div className="mt-1 text-label-small font-semibold text-m-on-surface-variant">Active</div>
        </div>
      </div>

      {/* Needs attention */}
      {opsData.attentionProjects.length > 0 && (
        <section>
          <h2 className="mb-3 text-label-large font-bold uppercase tracking-wide text-m-on-surface-variant">
            ⚡ Needs your attention
          </h2>
          <div className="flex flex-col gap-2">
            {opsData.attentionProjects.map((p) => (
              <OpsProjectRow key={p.id} project={p} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}

      {/* Recently active */}
      {opsData.recentProjects.length > 0 && (
        <section>
          <h2 className="mb-3 text-label-large font-bold uppercase tracking-wide text-m-on-surface-variant">
            Recently active
          </h2>
          <div className="flex flex-col gap-2">
            {opsData.recentProjects.map((p) => (
              <OpsProjectRow key={p.id} project={p} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}

      {opsData.totalActiveProjects === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-body-medium text-m-on-surface-variant">No active projects</p>
          <p className="mt-1 text-label-small text-m-on-surface-variant">
            Projects will appear here once they're in progress.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "OpsOverview" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/OpsOverview.tsx
git commit -m "feat(dashboard): add OpsOverview default panel"
```

---

## Task 7: `ProjectTree` component

The 240px left panel: health pills + filter input + client groups with `DashboardProjectRow`.

**Files:**
- Create: `src/components/dashboard/ProjectTree.tsx`

- [ ] **Step 1: Implement `ProjectTree`**

```typescript
// src/components/dashboard/ProjectTree.tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardProjectRow } from "./DashboardProjectRow";
import type { ClientWithProjects } from "@/hooks/useClientProjects";
import type { OpsOverviewData } from "@/hooks/useOpsOverview";

interface Props {
  clientsData: ClientWithProjects[];
  opsData: OpsOverviewData;
  selectedProjectId: string | null;
  hiddenIds: Set<string>;
  onSelect: (projectId: string) => void;
  onHide: (projectId: string) => void;
}

type ScopeFilter = "all" | "on_track" | "needs_attention" | "overdue";

function ClientSection({
  client,
  selectedProjectId,
  hiddenIds,
  scopeFilter,
  filterText,
  onSelect,
  onHide,
}: {
  client: ClientWithProjects;
  selectedProjectId: string | null;
  hiddenIds: Set<string>;
  scopeFilter: ScopeFilter;
  filterText: string;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  const visibleProjects = client.projects.filter((p) => {
    if (p.status !== "in_progress") return false;
    if (hiddenIds.has(p.id)) return false;
    if (scopeFilter !== "all" && p.scope_status !== scopeFilter) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      return p.name?.toLowerCase().includes(q) || client.name.toLowerCase().includes(q);
    }
    return true;
  });

  if (visibleProjects.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-label-small uppercase tracking-wide text-m-on-surface-variant hover:text-m-on-surface transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="truncate">{client.name}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-0.5 pl-2">
          {visibleProjects.map((p) => (
            <DashboardProjectRow
              key={p.id}
              id={p.id}
              name={p.name ?? "Untitled"}
              engagementType={p.engagement_type ?? "fixed"}
              scopeStatus={p.scope_status ?? "on_track"}
              isSelected={p.id === selectedProjectId}
              onSelect={onSelect}
              onHide={onHide}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectTree({ clientsData, opsData, selectedProjectId, hiddenIds, onSelect, onHide }: Props) {
  const [filterText, setFilterText] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");

  const pillClasses = (filter: ScopeFilter, active: string, inactive: string) =>
    cn(
      "cursor-pointer rounded px-2 py-0.5 text-label-small transition-colors",
      scopeFilter === filter ? active : inactive
    );

  return (
    <div className="flex flex-col border-r border-m-outline-variant bg-m-surface-container-low overflow-hidden">
      {/* Header */}
      <div className="border-b border-m-outline-variant px-3 pt-4 pb-2">
        <p className="mb-2 px-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">
          Projects
        </p>
        <input
          type="text"
          placeholder="Filter…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full rounded-md border border-m-outline-variant bg-m-surface px-2 py-1.5 text-label-medium text-m-on-surface placeholder:text-m-on-surface-variant focus:outline-none focus:ring-1 focus:ring-m-primary"
        />
      </div>

      {/* Health pills */}
      <div className="flex flex-wrap gap-1.5 border-b border-m-outline-variant px-3 py-2">
        <button
          onClick={() => setScopeFilter("on_track")}
          className={pillClasses("on_track", "bg-green-200 text-green-900", "bg-green-50 text-green-700")}
        >
          {opsData.onTrackCount} on track
        </button>
        <button
          onClick={() => setScopeFilter("needs_attention")}
          className={pillClasses("needs_attention", "bg-amber-200 text-amber-900", "bg-amber-50 text-amber-700")}
        >
          {opsData.needsAttentionCount} ⚠
        </button>
        {opsData.overdueCount > 0 && (
          <button
            onClick={() => setScopeFilter("overdue")}
            className={pillClasses("overdue", "bg-red-200 text-red-900", "bg-red-50 text-red-700")}
          >
            {opsData.overdueCount} 🔴
          </button>
        )}
        {scopeFilter !== "all" && (
          <button
            onClick={() => setScopeFilter("all")}
            className="rounded px-2 py-0.5 text-label-small text-m-on-surface-variant hover:text-m-on-surface"
          >
            ✕ clear
          </button>
        )}
      </div>

      {/* Client sections */}
      <nav className="flex-1 overflow-y-auto px-1 py-2">
        {clientsData.map((client) => (
          <ClientSection
            key={client.id}
            client={client}
            selectedProjectId={selectedProjectId}
            hiddenIds={hiddenIds}
            scopeFilter={scopeFilter}
            filterText={filterText}
            onSelect={onSelect}
            onHide={onHide}
          />
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "ProjectTree" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ProjectTree.tsx
git commit -m "feat(dashboard): add ProjectTree left panel"
```

---

## Task 8: `DashboardShell` + `DashboardPage`

Wires together icon rail, project tree, and detail panel. Owns all state.

**Files:**
- Create: `src/components/dashboard/DashboardShell.tsx`
- Create: `src/pages/DashboardPage.tsx`

- [ ] **Step 1: Implement `DashboardShell`**

```typescript
// src/components/dashboard/DashboardShell.tsx
import { useState } from "react";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useOpsOverview } from "@/hooks/useOpsOverview";
import { useHiddenProjects } from "@/hooks/useHiddenProjects";
import { IconRail } from "@/components/nav/IconRail";
import { NavOverlay } from "@/components/nav/NavOverlay";
import { ProjectTree } from "./ProjectTree";
import { OpsOverview } from "./OpsOverview";
import { DashboardProjectView } from "./DashboardProjectView";

export function DashboardShell() {
  const { data: clientsData = [] } = useClientProjects();
  const opsData = useOpsOverview(clientsData);
  const { hiddenIds, hide } = useHiddenProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const selectedClient = clientsData.find((c) =>
    c.projects.some((p) => p.id === selectedProjectId)
  );
  const selectedClientName = selectedClient?.name ?? "";

  function handleSelect(projectId: string) {
    setSelectedProjectId(projectId);
  }

  function handleComplete() {
    setSelectedProjectId(null);
  }

  return (
    <div className="grid h-screen grid-cols-[56px_240px_1fr] bg-m-surface-container-low overflow-hidden">
      {/* Column 1: icon rail */}
      <IconRail navOpen={navOpen} onToggle={() => setNavOpen((o) => !o)} />

      {/* Column 2: project tree */}
      <ProjectTree
        clientsData={clientsData}
        opsData={opsData}
        selectedProjectId={selectedProjectId}
        hiddenIds={hiddenIds}
        onSelect={handleSelect}
        onHide={hide}
      />

      {/* Column 3: detail or overview */}
      <main className="flex min-h-0 flex-col overflow-hidden bg-m-surface">
        {selectedProjectId ? (
          <DashboardProjectView
            key={selectedProjectId}
            projectId={selectedProjectId}
            clientName={selectedClientName}
            onComplete={handleComplete}
          />
        ) : (
          <OpsOverview opsData={opsData} onSelect={handleSelect} />
        )}
      </main>

      <NavOverlay open={navOpen} onClose={() => setNavOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2: Implement `DashboardPage`**

```typescript
// src/pages/DashboardPage.tsx
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export function DashboardPage() {
  return <DashboardShell />;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "DashboardShell\|DashboardPage" | head -10
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/DashboardShell.tsx src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): add DashboardShell and DashboardPage"
```

---

## Task 9: Wire routes + simplify AppShell

Two changes in one commit: `App.tsx` gets the new `/` route outside `AppShell`, and `AppShell` loses its sidebar column.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx`

- [ ] **Step 1: Update `App.tsx`**

Replace the entire file content:

```typescript
// src/App.tsx
import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { AuthProvider } from "@/context/AuthContext";
import { Login } from "@/pages/Login";
import { DashboardPage } from "@/pages/DashboardPage";

const ServicesList = lazy(() =>
  import("@/pages/ServicesList").then((m) => ({ default: m.ServicesList })),
);
const ServiceDetail = lazy(() =>
  import("@/pages/ServiceDetail").then((m) => ({ default: m.ServiceDetail })),
);
const Rules = lazy(() =>
  import("@/pages/Rules").then((m) => ({ default: m.Rules })),
);
const Departments = lazy(() =>
  import("@/pages/Departments").then((m) => ({ default: m.Departments })),
);
const Team = lazy(() =>
  import("@/pages/Team").then((m) => ({ default: m.Team })),
);
const Inbox = lazy(() =>
  import("@/pages/Inbox").then((m) => ({ default: m.Inbox })),
);
const NewBrief = lazy(() =>
  import("@/pages/NewBrief").then((m) => ({ default: m.NewBrief })),
);
const Scope = lazy(() =>
  import("@/pages/Scope").then((m) => ({ default: m.Scope })),
);
const ProjectBuilder = lazy(() =>
  import("@/pages/ProjectBuilder").then((m) => ({ default: m.ProjectBuilder })),
);
const QuoteSend = lazy(() =>
  import("@/pages/QuoteSend").then((m) => ({ default: m.QuoteSend })),
);
const QuoteDetail = lazy(() =>
  import("@/pages/QuoteDetail").then((m) => ({ default: m.QuoteDetail })),
);
const Projects = lazy(() =>
  import("@/pages/Projects").then((m) => ({ default: m.Projects })),
);
const ProjectDetail = lazy(() =>
  import("@/pages/ProjectDetail").then((m) => ({ default: m.ProjectDetail })),
);
const Clients = lazy(() =>
  import("@/pages/Clients").then((m) => ({ default: m.Clients })),
);
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const SettingsConnectGmail = lazy(() =>
  import("@/pages/SettingsConnectGmail").then((m) => ({ default: m.SettingsConnectGmail })),
);
const Guides = lazy(() =>
  import("@/pages/Guides").then((m) => ({ default: m.Guides })),
);
const ProjectScopeView = lazy(() =>
  import("@/pages/ProjectScopeView").then((m) => ({ default: m.ProjectScopeView })),
);

function RouteFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-body-medium text-m-on-surface-variant">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            {/* Dashboard — standalone IDE layout, no AppShell */}
            <Route index element={<DashboardPage />} />

            {/* All other routes — AppShell without sidebar */}
            <Route element={<AppShell />}>
              <Route path="inbox" element={<Inbox />} />
              <Route path="inbox/:briefId" element={<Inbox />} />
              <Route path="briefs/new" element={<NewBrief />} />
              <Route path="briefs/:id/scope" element={<Scope />} />
              <Route path="briefs/:id/builder" element={<ProjectBuilder />} />
              <Route path="quotes/:id" element={<QuoteDetail />} />
              <Route path="quotes/:id/send" element={<QuoteSend />} />
              <Route path="clients" element={<Clients />} />
              <Route path="clients/:clientId/projects/:projectId" element={<ProjectScopeView />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/:id" element={<ProjectDetail />} />
              <Route path="settings" element={<Settings />} />
              <Route path="settings/gmail" element={<SettingsConnectGmail />} />
              <Route path="services" element={<ServicesList />} />
              <Route path="services/new" element={<ServiceDetail mode="new" />} />
              <Route path="services/:id" element={<ServiceDetail mode="edit" />} />
              <Route path="rules" element={<Rules />} />
              <Route path="departments" element={<Departments />} />
              <Route path="team" element={<Team />} />
              <Route path="guides" element={<Guides />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
```

- [ ] **Step 2: Update `AppShell.tsx` — remove the sidebar column**

The `InboxNavSection` that lived in the sidebar was the only trigger for `InboxAssignModal` in AppShell. With the sidebar removed, that trigger is also gone — so `inboxBrief` state and `InboxAssignModal` can be removed from AppShell too. (The Inbox page itself handles assignment modals internally.)

Replace the entire file content:

```typescript
// src/components/AppShell.tsx
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { IconRail } from "@/components/nav/IconRail";
import { NavOverlay } from "@/components/nav/NavOverlay";

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen grid grid-cols-[56px_1fr] bg-m-surface-container-low">
      {/* Column 1: icon rail */}
      <IconRail navOpen={navOpen} onToggle={() => setNavOpen((o) => !o)} />

      {/* Column 2: main content */}
      <main className="flex min-h-screen flex-col overflow-auto">
        <Outlet />
      </main>

      <NavOverlay open={navOpen} onClose={() => setNavOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 3: Confirm `InboxNavSection` is only used in AppShell**

```bash
grep -r "InboxNavSection" /Users/brendangunn/Github/cc-service-calculator/src --include="*.tsx" --include="*.ts" -l
```

It is only used in `AppShell` — leave the component file in place (its tests still pass). Note: the `InboxNavSection` quick-assign flow (click a brief in the sidebar → open `InboxAssignModal`) is removed as a consequence of removing the sidebar. The full Inbox page remains reachable via the icon rail at `/inbox`.

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors. If `InboxNavSection` import removal causes an error, remove the import from `AppShell.tsx`.

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all previously passing tests still pass.

- [ ] **Step 6: Start dev server and manually verify**

```bash
npm run dev
```

Open http://localhost:5174:
- `/` — should show the Ops IDE dashboard with project tree on the left and OpsOverview on the right
- Click any project in the tree → should show `DashboardProjectView` on the right
- Hover a project row → `✓` dismiss button should appear
- Click dismiss → project disappears from the tree
- Click `✓ Complete` in the detail panel header → confirm dialog → project disappears from tree
- Navigate to `/inbox` → should show icon rail + main content only (no sidebar)
- Navigate to `/services` → same: icon rail + main only

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/AppShell.tsx
git commit -m "feat(dashboard): wire ops IDE dashboard route and simplify AppShell"
```

---

## Post-implementation checklist

- [ ] All unit tests pass: `npx vitest run`
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] Dashboard loads at `/` with project tree and ops overview
- [ ] Selecting a project shows the detail panel with correct project data
- [ ] Dismiss (✓ hover) hides the project from the tree for the session
- [ ] Complete writes `status = completed` to DB and deselects the project
- [ ] Health pills in the tree filter the project list
- [ ] Text filter in the tree works across project and client names
- [ ] All non-dashboard routes render with icon rail + main content only (no sidebar)
- [ ] Existing tests for `ProjectNavRow`, `ClientNavSection`, `IconRail` all still pass
