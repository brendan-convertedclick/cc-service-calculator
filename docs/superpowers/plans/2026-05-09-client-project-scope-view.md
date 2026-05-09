# Client → Project Scope View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the app shell navigation to a three-tier Client → Project → Thread model with a three-pane project scope view — left sidebar with client/project nav, centre activity feed, right status strip.

**Architecture:** The existing AppShell sidebar is extended with dynamic client/project sections below the static nav links. New routes `/clients/:clientId/projects/:projectId` render a `ProjectScopeView` page that manages its own internal two-column layout (centre + right). The left sidebar remains 240px; the right status strip is 280px inside the page. All data flows through TanStack Query hooks backed by Supabase.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind (M3 tokens), shadcn/ui (Sheet, Tabs, Badge, Collapsible), TanStack Query, React Router 7, Supabase JS, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-09-client-project-scope-view-design.md`

---

## File map

**New files:**
- `supabase/migrations/0030_project_scope_view.sql`
- `src/hooks/useClientProjects.ts`
- `src/hooks/useProjectActivity.ts`
- `src/hooks/useInboxBriefs.ts`
- `src/hooks/useAssignBriefToProject.ts`
- `src/components/nav/ProjectNavRow.tsx`
- `src/components/nav/ClientNavSection.tsx`
- `src/components/nav/InboxNavSection.tsx`
- `src/components/scope/ActivityFeed.tsx`
- `src/components/scope/FeedEvent.tsx`
- `src/components/scope/StatusStrip.tsx`
- `src/components/scope/InboxAssignModal.tsx`
- `src/pages/ProjectScopeView.tsx`

**Modified files:**
- `src/components/AppShell.tsx` — extend sidebar with client nav
- `src/App.tsx` — add new routes
- `src/types/db.ts` — regenerated after migration

**Test files (co-located):**
- `src/hooks/useClientProjects.test.ts`
- `src/hooks/useProjectActivity.test.ts`
- `src/hooks/useInboxBriefs.test.ts`
- `src/hooks/useAssignBriefToProject.test.ts`
- `src/components/nav/ProjectNavRow.test.tsx`
- `src/components/nav/ClientNavSection.test.tsx`
- `src/components/nav/InboxNavSection.test.tsx`
- `src/components/scope/ActivityFeed.test.tsx`
- `src/components/scope/StatusStrip.test.tsx`
- `src/pages/ProjectScopeView.test.tsx`

---

## Task 1: Migration 0030 — project scope view columns + backfill

**Files:**
- Create: `supabase/migrations/0030_project_scope_view.sql`
- Modify: `src/types/db.ts` (via regen command)

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/0030_project_scope_view.sql

-- Extend projects with client_id (denormalized), engagement_type, status
ALTER TABLE public.projects
  ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN engagement_type text NOT NULL DEFAULT 'fixed'
    CHECK (engagement_type IN ('fixed', 'retainer')),
  ADD COLUMN status text NOT NULL DEFAULT 'on_track'
    CHECK (status IN ('on_track', 'needs_attention', 'overdue'));

-- Backfill client_id: project → quote → scope → brief → client
UPDATE public.projects p
SET client_id = b.client_id
FROM public.quotes q
JOIN public.scopes sc ON sc.id = q.scope_id
JOIN public.briefs b  ON b.id  = sc.brief_id
WHERE p.quote_id = q.id
  AND b.client_id IS NOT NULL;

-- Add parent_project_id to briefs (null = Inbox item, set = linked to project)
ALTER TABLE public.briefs
  ADD COLUMN parent_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- Performance indexes for sidebar queries
CREATE INDEX idx_projects_client_id ON public.projects(client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX idx_briefs_parent_project_id ON public.briefs(parent_project_id)
  WHERE parent_project_id IS NOT NULL;
CREATE INDEX idx_briefs_inbox ON public.briefs(created_at DESC)
  WHERE parent_project_id IS NULL;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push --project-ref lpgwxacoqiqpcfpkklib
```

Expected: `Applied migration 0030_project_scope_view` with no errors.

- [ ] **Step 3: Regenerate TypeScript types**

```bash
npx supabase gen types typescript --project-id lpgwxacoqiqpcfpkklib > src/types/db.ts
```

Expected: `src/types/db.ts` now includes `client_id`, `engagement_type`, `status` on `projects` rows and `parent_project_id` on `briefs` rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0030_project_scope_view.sql src/types/db.ts
git commit -m "feat(db): add client_id, engagement_type, status to projects; parent_project_id to briefs"
```

---

## Task 2: `useClientProjects` hook

**Files:**
- Create: `src/hooks/useClientProjects.ts`
- Create: `src/hooks/useClientProjects.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useClientProjects.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    }),
  },
}));

import { useClientProjects } from "./useClientProjects";
import { supabase } from "@/lib/supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useClientProjects", () => {
  it("returns clients with nested projects", async () => {
    const mockData = [
      {
        id: "client-1",
        name: "ACME",
        primary_domain: "acme.co.za",
        created_at: "2026-01-01T00:00:00Z",
        projects: [
          {
            id: "proj-1",
            name: "Website Rebuild",
            project_code: "ACME-001",
            engagement_type: "fixed",
            status: "on_track",
            client_id: "client-1",
            quote_id: "quote-1",
            started_at: "2026-03-01T00:00:00Z",
            created_at: "2026-03-01T00:00:00Z",
          },
        ],
      },
    ];

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    } as any);

    const { result } = renderHook(() => useClientProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].name).toBe("ACME");
    expect(result.current.data![0].projects).toHaveLength(1);
    expect(result.current.data![0].projects[0].engagement_type).toBe("fixed");
  });

  it("returns empty array when no clients", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any);

    const { result } = renderHook(() => useClientProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("throws on Supabase error", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
    } as any);

    const { result } = renderHook(() => useClientProjects(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/hooks/useClientProjects.test.ts
```

Expected: FAIL — `useClientProjects` not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useClientProjects.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type Project = Database["public"]["Tables"]["projects"]["Row"];

export type ClientWithProjects = Client & {
  projects: Project[];
};

export function useClientProjects() {
  return useQuery({
    queryKey: ["clientProjects"],
    queryFn: async (): Promise<ClientWithProjects[]> => {
      const { data, error } = await supabase
        .from("clients")
        .select(
          `id, name, primary_domain, created_at,
           projects (
             id, name, project_code, engagement_type, status,
             client_id, quote_id, started_at, created_at
           )`
        )
        .order("name")
        .order("started_at", { referencedTable: "projects", ascending: false });

      if (error) throw error;
      return (data ?? []) as ClientWithProjects[];
    },
  });
}
```

- [ ] **Step 4: Run tests to confirm passing**

```bash
npx vitest run src/hooks/useClientProjects.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useClientProjects.ts src/hooks/useClientProjects.test.ts
git commit -m "feat(hooks): useClientProjects — clients with nested projects"
```

---

## Task 3: `useProjectActivity` hook + ActivityEvent types

**Files:**
- Create: `src/hooks/useProjectActivity.ts`
- Create: `src/hooks/useProjectActivity.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/hooks/useProjectActivity.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockBrief = {
  id: "brief-1",
  raw_subject: "Website scope",
  intent_type: "new_brief",
  sender_email: "client@acme.co.za",
  created_at: "2026-05-01T10:00:00Z",
  parent_project_id: "proj-1",
  status: "open",
};

const mockActual = {
  project_id: "proj-1",
  department_id: "dept-1",
  department_name: "Dev",
  total_hours: 10,
  updated_at: "2026-05-06T10:00:00Z",
};

const mockQuote = {
  id: "quote-1",
  status: "sent",
  total_price_cents: 4850000,
  sent_at: "2026-05-07T10:00:00Z",
  scope_id: "scope-1",
};

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { useProjectActivity } from "./useProjectActivity";
import { supabase } from "@/lib/supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

function mockFrom(table: string) {
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
  if (table === "briefs") chain.eq = vi.fn().mockResolvedValue({ data: [mockBrief], error: null });
  if (table === "project_actuals_current") chain.eq = vi.fn().mockResolvedValue({ data: [mockActual], error: null });
  if (table === "quotes") chain.eq = vi.fn().mockResolvedValue({ data: [mockQuote], error: null });
  return chain;
}

describe("useProjectActivity", () => {
  it("returns merged sorted activity events for a project", async () => {
    vi.mocked(supabase.from).mockImplementation((t: string) => mockFrom(t) as any);

    const { result } = renderHook(() => useProjectActivity("proj-1", "quote-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const events = result.current.data!;
    expect(events.length).toBeGreaterThanOrEqual(3);
    // Events sorted newest first
    const timestamps = events.map((e) => e.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b.localeCompare(a)));
  });

  it("returns empty array when projectId is undefined", async () => {
    const { result } = renderHook(() => useProjectActivity(undefined, undefined), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/hooks/useProjectActivity.test.ts
```

Expected: FAIL — `useProjectActivity` not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useProjectActivity.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];
type Quote = Database["public"]["Tables"]["quotes"]["Row"];

export type ActivityEvent =
  | { type: "brief"; timestamp: string; id: string; brief: Brief }
  | { type: "actuals_update"; timestamp: string; id: string; departmentName: string; totalHours: number }
  | { type: "quote"; timestamp: string; id: string; quote: Quote };

export function useProjectActivity(
  projectId: string | undefined,
  quoteId: string | undefined
) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ["projectActivity", projectId],
    queryFn: async (): Promise<ActivityEvent[]> => {
      if (!projectId) return [];

      const [briefsRes, actualsRes, quotesRes] = await Promise.all([
        supabase
          .from("briefs")
          .select("*")
          .eq("parent_project_id", projectId),
        supabase
          .from("project_actuals_current")
          .select("*")
          .eq("project_id", projectId),
        quoteId
          ? supabase.from("quotes").select("*").eq("id", quoteId)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (briefsRes.error) throw briefsRes.error;
      if (actualsRes.error) throw actualsRes.error;
      if (quotesRes.error) throw quotesRes.error;

      const events: ActivityEvent[] = [
        ...(briefsRes.data ?? []).map((b): ActivityEvent => ({
          type: "brief",
          timestamp: b.created_at,
          id: b.id,
          brief: b,
        })),
        ...(actualsRes.data ?? []).map((a): ActivityEvent => ({
          type: "actuals_update",
          timestamp: a.updated_at ?? a.project_id,
          id: `${a.project_id}-${a.department_id}`,
          departmentName: (a as any).department_name ?? "Unknown",
          totalHours: (a as any).total_hours ?? 0,
        })),
        ...(quotesRes.data ?? []).map((q): ActivityEvent => ({
          type: "quote",
          timestamp: (q as any).sent_at ?? q.created_at,
          id: q.id,
          quote: q as Quote,
        })),
      ];

      return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    },
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/hooks/useProjectActivity.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProjectActivity.ts src/hooks/useProjectActivity.test.ts
git commit -m "feat(hooks): useProjectActivity — merged activity event feed for a project"
```

---

## Task 4: `useInboxBriefs` + `useAssignBriefToProject` hooks

**Files:**
- Create: `src/hooks/useInboxBriefs.ts`
- Create: `src/hooks/useAssignBriefToProject.ts`
- Create: `src/hooks/useInboxBriefs.test.ts`
- Create: `src/hooks/useAssignBriefToProject.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/hooks/useInboxBriefs.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: "brief-1", raw_subject: "Inbox item", parent_project_id: null, created_at: "2026-05-09T10:00:00Z" }],
        error: null,
      }),
    }),
  },
}));

import { useInboxBriefs } from "./useInboxBriefs";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useInboxBriefs", () => {
  it("returns briefs where parent_project_id is null", async () => {
    const { result } = renderHook(() => useInboxBriefs(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe("brief-1");
  });
});
```

```ts
// src/hooks/useAssignBriefToProject.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockSingle = vi.fn().mockResolvedValue({
  data: { id: "brief-1", parent_project_id: "proj-1" },
  error: null,
});
const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: mockSelect }) });

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn().mockReturnValue({ update: mockUpdate }) },
}));

import { useAssignBriefToProject } from "./useAssignBriefToProject";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useAssignBriefToProject", () => {
  it("calls update with parent_project_id", async () => {
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ briefId: "brief-1", projectId: "proj-1" });
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ parent_project_id: "proj-1" })
    );
  });

  it("accepts null projectId to unlink", async () => {
    const { result } = renderHook(() => useAssignBriefToProject(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ briefId: "brief-1", projectId: null });
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ parent_project_id: null })
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/hooks/useInboxBriefs.test.ts src/hooks/useAssignBriefToProject.test.ts
```

Expected: FAIL on both.

- [ ] **Step 3: Implement `useInboxBriefs`**

```ts
// src/hooks/useInboxBriefs.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

export function useInboxBriefs() {
  return useQuery({
    queryKey: ["inboxBriefs"],
    queryFn: async (): Promise<Brief[]> => {
      const { data, error } = await supabase
        .from("briefs")
        .select("*")
        .is("parent_project_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 4: Implement `useAssignBriefToProject`**

```ts
// src/hooks/useAssignBriefToProject.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

export function useAssignBriefToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      briefId,
      projectId,
    }: {
      briefId: string;
      projectId: string | null;
    }): Promise<Brief> => {
      const { data, error } = await supabase
        .from("briefs")
        .update({ parent_project_id: projectId, updated_at: new Date().toISOString() })
        .eq("id", briefId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["inboxBriefs"] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["clientProjects"] });
      if (vars.projectId) {
        qc.invalidateQueries({ queryKey: ["projectActivity", vars.projectId] });
      }
    },
  });
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/hooks/useInboxBriefs.test.ts src/hooks/useAssignBriefToProject.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useInboxBriefs.ts src/hooks/useInboxBriefs.test.ts \
        src/hooks/useAssignBriefToProject.ts src/hooks/useAssignBriefToProject.test.ts
git commit -m "feat(hooks): useInboxBriefs + useAssignBriefToProject"
```

---

## Task 5: Nav components — ProjectNavRow, ClientNavSection, InboxNavSection

**Files:**
- Create: `src/components/nav/ProjectNavRow.tsx`
- Create: `src/components/nav/ClientNavSection.tsx`
- Create: `src/components/nav/InboxNavSection.tsx`
- Create: `src/components/nav/ProjectNavRow.test.tsx`
- Create: `src/components/nav/ClientNavSection.test.tsx`
- Create: `src/components/nav/InboxNavSection.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/nav/ProjectNavRow.test.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectNavRow } from "./ProjectNavRow";

const proj = {
  id: "proj-1",
  name: "Website Rebuild",
  project_code: "ACME-001",
  engagement_type: "fixed" as const,
  status: "on_track" as const,
  client_id: "client-1",
  quote_id: "quote-1",
  started_at: "2026-03-01T00:00:00Z",
  created_at: "2026-03-01T00:00:00Z",
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("ProjectNavRow", () => {
  it("renders project name", () => {
    render(<ProjectNavRow project={proj} clientId="client-1" />, { wrapper: Wrapper });
    expect(screen.getByText("Website Rebuild")).toBeInTheDocument();
  });

  it("renders engagement type chip", () => {
    render(<ProjectNavRow project={proj} clientId="client-1" />, { wrapper: Wrapper });
    expect(screen.getByText("fixed")).toBeInTheDocument();
  });

  it("links to the project scope view", () => {
    render(<ProjectNavRow project={proj} clientId="client-1" />, { wrapper: Wrapper });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/clients/client-1/projects/proj-1");
  });

  it("shows amber dot for needs_attention status", () => {
    render(
      <ProjectNavRow project={{ ...proj, status: "needs_attention" }} clientId="client-1" />,
      { wrapper: Wrapper }
    );
    expect(screen.getByTestId("status-dot")).toHaveClass("bg-amber-400");
  });
});
```

```tsx
// src/components/nav/ClientNavSection.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClientNavSection } from "./ClientNavSection";

const client = {
  id: "client-1",
  name: "ACME",
  primary_domain: "acme.co.za",
  created_at: "2026-01-01T00:00:00Z",
  projects: [
    {
      id: "proj-1",
      name: "Website Rebuild",
      project_code: "ACME-001",
      engagement_type: "fixed" as const,
      status: "on_track" as const,
      client_id: "client-1",
      quote_id: null,
      started_at: "2026-03-01T00:00:00Z",
      created_at: "2026-03-01T00:00:00Z",
    },
  ],
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("ClientNavSection", () => {
  it("renders client name as section header", () => {
    render(<ClientNavSection client={client} />, { wrapper: Wrapper });
    expect(screen.getByText("ACME")).toBeInTheDocument();
  });

  it("renders projects within the section", () => {
    render(<ClientNavSection client={client} />, { wrapper: Wrapper });
    expect(screen.getByText("Website Rebuild")).toBeInTheDocument();
  });

  it("collapses to hide projects on header click", () => {
    render(<ClientNavSection client={client} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText("ACME"));
    expect(screen.queryByText("Website Rebuild")).not.toBeVisible();
  });
});
```

```tsx
// src/components/nav/InboxNavSection.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/hooks/useInboxBriefs", () => ({
  useInboxBriefs: () => ({
    data: [
      { id: "b1", raw_subject: "New request from ACME", sender_email: "a@acme.co.za", created_at: "2026-05-09T10:00:00Z" },
      { id: "b2", raw_subject: "Question about pricing", sender_email: "b@pebble.io", created_at: "2026-05-08T10:00:00Z" },
    ],
    isLoading: false,
  }),
}));

import { InboxNavSection } from "./InboxNavSection";
import { vi } from "vitest";

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("InboxNavSection", () => {
  it("shows count badge with number of inbox briefs", () => {
    render(<InboxNavSection onSelectBrief={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders inbox brief subjects", () => {
    render(<InboxNavSection onSelectBrief={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("New request from ACME")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run src/components/nav/
```

Expected: FAIL — all three components not found.

- [ ] **Step 3: Implement `ProjectNavRow`**

```tsx
// src/components/nav/ProjectNavRow.tsx
import { Link, useMatch } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];

const statusDot: Record<string, string> = {
  on_track: "bg-green-500",
  needs_attention: "bg-amber-400",
  overdue: "bg-red-500",
};

interface Props {
  project: Project;
  clientId: string;
}

export function ProjectNavRow({ project, clientId }: Props) {
  const to = `/clients/${clientId}/projects/${project.id}`;
  const match = useMatch(to);

  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-label-medium transition-colors",
        match
          ? "bg-m-primary-container text-m-on-primary-container"
          : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
      )}
    >
      <span
        data-testid="status-dot"
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          statusDot[project.status ?? "on_track"]
        )}
      />
      <span className="flex-1 truncate">{project.name}</span>
      <span className="shrink-0 rounded px-1 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
        {project.engagement_type ?? "fixed"}
      </span>
    </Link>
  );
}
```

- [ ] **Step 4: Implement `ClientNavSection`**

```tsx
// src/components/nav/ClientNavSection.tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectNavRow } from "./ProjectNavRow";
import type { ClientWithProjects } from "@/hooks/useClientProjects";

interface Props {
  client: ClientWithProjects;
  defaultOpen?: boolean;
}

export function ClientNavSection({ client, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-label-small uppercase tracking-wide text-m-on-surface-variant hover:text-m-on-surface transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{client.name}</span>
      </button>

      <div className={cn("flex flex-col gap-0.5 pl-2", !open && "hidden")}>
        {client.projects.length === 0 && (
          <p className="px-3 py-1 text-label-small text-m-on-surface-variant italic">
            No active projects
          </p>
        )}
        {client.projects.map((p) => (
          <ProjectNavRow key={p.id} project={p} clientId={client.id} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `InboxNavSection`**

```tsx
// src/components/nav/InboxNavSection.tsx
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxBriefs } from "@/hooks/useInboxBriefs";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

interface Props {
  onSelectBrief: (brief: Brief) => void;
}

export function InboxNavSection({ onSelectBrief }: Props) {
  const { data: briefs = [], isLoading } = useInboxBriefs();

  if (isLoading || briefs.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Inbox className="h-3.5 w-3.5 text-m-on-surface-variant" />
        <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">
          Inbox
        </span>
        <span className="ml-auto rounded-full bg-m-primary px-1.5 py-0.5 text-[10px] font-medium text-m-on-primary">
          {briefs.length}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 pl-2">
        {briefs.map((brief) => (
          <button
            key={brief.id}
            onClick={() => onSelectBrief(brief)}
            className={cn(
              "flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors",
              "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
            )}
          >
            <span className="truncate text-label-medium">
              {brief.raw_subject ?? "(no subject)"}
            </span>
            <span className="text-label-small text-m-on-surface-variant">
              {brief.sender_email}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/components/nav/
```

Expected: All tests pass. Note: the collapse test uses `not.toBeVisible()` which requires the `hidden` class to visually hide — if Tailwind's purge removes it in test, adjust to check for class presence instead: `expect(container.querySelector('.hidden')).toBeTruthy()`.

- [ ] **Step 7: Commit**

```bash
git add src/components/nav/
git commit -m "feat(nav): ProjectNavRow, ClientNavSection, InboxNavSection components"
```

---

## Task 6: Extend AppShell left nav + add new routes in App.tsx

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add client nav to AppShell sidebar**

In `src/components/AppShell.tsx`, add the following imports at the top:

```tsx
import { useState } from "react";
import { useClientProjects } from "@/hooks/useClientProjects";
import { ClientNavSection } from "@/components/nav/ClientNavSection";
import { InboxNavSection } from "@/components/nav/InboxNavSection";
import { InboxAssignModal } from "@/components/scope/InboxAssignModal";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];
```

Inside the `AppShell` function body, before the return, add:

```tsx
const { data: clientsWithProjects = [] } = useClientProjects();
const [inboxBrief, setInboxBrief] = useState<Brief | null>(null);
```

Inside `<nav className="flex flex-1 flex-col gap-0.5 px-3 pt-2">`, after the closing `{nav.map(...)}` block and before `</nav>`, add:

```tsx
{/* Divider */}
<div className="my-2 border-t border-m-outline-variant" />

{/* Inbox — unlinked briefs */}
<InboxNavSection onSelectBrief={(b) => setInboxBrief(b)} />

{/* Client → Project nav */}
{clientsWithProjects.map((client) => (
  <ClientNavSection key={client.id} client={client} />
))}
```

After the closing `</aside>` tag (inside the main return, before the closing `</div>`), add:

```tsx
{inboxBrief && (
  <InboxAssignModal
    brief={inboxBrief}
    open={!!inboxBrief}
    onClose={() => setInboxBrief(null)}
  />
)}
```

- [ ] **Step 2: Add new routes in App.tsx**

Add a lazy import for `ProjectScopeView` with the other lazy imports:

```tsx
const ProjectScopeView = lazy(() =>
  import("@/pages/ProjectScopeView").then((m) => ({ default: m.ProjectScopeView })),
);
```

Inside the `<Route element={<AppShell />}>` block, after the `clients` route, add:

```tsx
<Route path="clients/:clientId/projects/:projectId" element={<ProjectScopeView />} />
```

- [ ] **Step 3: Verify the app compiles**

```bash
npx tsc --noEmit
```

Expected: Type errors only for missing `ProjectScopeView` and `InboxAssignModal` files — not for the hook or nav changes.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppShell.tsx src/App.tsx
git commit -m "feat(shell): wire client/project nav into AppShell sidebar + add scope view routes"
```

---

## Task 7: ActivityFeed + FeedEvent components

**Files:**
- Create: `src/components/scope/ActivityFeed.tsx`
- Create: `src/components/scope/FeedEvent.tsx`
- Create: `src/components/scope/ActivityFeed.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/scope/ActivityFeed.test.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityFeed } from "./ActivityFeed";
import type { ActivityEvent } from "@/hooks/useProjectActivity";

const events: ActivityEvent[] = [
  {
    type: "brief",
    timestamp: "2026-05-09T10:00:00Z",
    id: "b1",
    brief: {
      id: "b1",
      raw_subject: "Can we add a blog?",
      intent_type: "project_thread",
      sender_email: "sarah@acme.co.za",
      status: "open",
      created_at: "2026-05-09T10:00:00Z",
    } as any,
  },
  {
    type: "quote",
    timestamp: "2026-05-07T10:00:00Z",
    id: "q1",
    quote: {
      id: "q1",
      status: "sent",
      total_price_cents: 4850000,
      sent_at: "2026-05-07T10:00:00Z",
    } as any,
  },
  {
    type: "actuals_update",
    timestamp: "2026-05-06T10:00:00Z",
    id: "act-1",
    departmentName: "Development",
    totalHours: 12,
  },
];

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("ActivityFeed", () => {
  it("renders all events", () => {
    render(<ActivityFeed events={events} isLoading={false} />, { wrapper: Wrapper });
    expect(screen.getByText("Can we add a blog?")).toBeInTheDocument();
    expect(screen.getByText(/R48,500/)).toBeInTheDocument();
    expect(screen.getByText(/Development/)).toBeInTheDocument();
  });

  it("shows loading skeleton when isLoading", () => {
    render(<ActivityFeed events={[]} isLoading={true} />, { wrapper: Wrapper });
    expect(screen.getByTestId("activity-loading")).toBeInTheDocument();
  });

  it("shows empty state when no events", () => {
    render(<ActivityFeed events={[]} isLoading={false} />, { wrapper: Wrapper });
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/components/scope/ActivityFeed.test.tsx
```

Expected: FAIL — components not found.

- [ ] **Step 3: Implement `FeedEvent`**

```tsx
// src/components/scope/FeedEvent.tsx
import { Mail, FileText, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/hooks/useProjectActivity";

const intentLabels: Record<string, string> = {
  new_brief: "New brief",
  project_thread: "Project thread",
  retainer_thread: "Retainer thread",
  general_query: "Query",
  quick_response: "Quick response",
};

function formatZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    cents / 100
  );
}

function relativeDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

interface Props {
  event: ActivityEvent;
}

export function FeedEvent({ event }: Props) {
  if (event.type === "brief") {
    const { brief } = event;
    return (
      <div className="flex gap-3">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-m-primary-container">
          <Mail className="h-3.5 w-3.5 text-m-on-primary-container" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-body-medium text-m-on-surface">
              {brief.raw_subject ?? "(no subject)"}
            </span>
            {brief.intent_type && (
              <span className="rounded px-1.5 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
                {intentLabels[brief.intent_type] ?? brief.intent_type}
              </span>
            )}
          </div>
          <div className="text-label-small text-m-on-surface-variant">
            {brief.sender_email} · {relativeDate(event.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  if (event.type === "quote") {
    const { quote } = event;
    return (
      <div className="flex gap-3">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-m-surface-container">
          <FileText className="h-3.5 w-3.5 text-m-on-surface-variant" />
        </div>
        <div className="flex-1">
          <div className="text-body-medium text-m-on-surface">
            Quote {(quote as any).status === "sent" ? "sent" : (quote as any).status} —{" "}
            {formatZAR((quote as any).total_price_cents ?? 0)}
          </div>
          <div className="text-label-small text-m-on-surface-variant">
            {relativeDate(event.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  if (event.type === "actuals_update") {
    return (
      <div className="flex gap-3">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-m-surface-container">
          <Clock className="h-3.5 w-3.5 text-m-on-surface-variant" />
        </div>
        <div className="flex-1">
          <div className="text-body-medium text-m-on-surface">
            {event.departmentName} — {event.totalHours}h logged
          </div>
          <div className="text-label-small text-m-on-surface-variant">
            {relativeDate(event.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 4: Implement `ActivityFeed`**

```tsx
// src/components/scope/ActivityFeed.tsx
import { FeedEvent } from "./FeedEvent";
import type { ActivityEvent } from "@/hooks/useProjectActivity";

interface Props {
  events: ActivityEvent[];
  isLoading: boolean;
  onAddBrief?: () => void;
}

export function ActivityFeed({ events, isLoading, onAddBrief }: Props) {
  if (isLoading) {
    return (
      <div data-testid="activity-loading" className="flex flex-col gap-4 p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-m-surface-container" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
        <p className="text-body-medium text-m-on-surface-variant">No activity yet</p>
        <p className="text-label-small text-m-on-surface-variant">
          Activity from emails, tasks, and quotes will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {events.map((event) => (
        <FeedEvent key={`${event.type}-${event.id}`} event={event} />
      ))}
      {onAddBrief && (
        <button
          onClick={onAddBrief}
          className="mt-2 w-full rounded-lg border border-dashed border-m-outline-variant py-3 text-label-medium text-m-on-surface-variant transition-colors hover:bg-m-surface-container"
        >
          + Add brief to project
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/components/scope/ActivityFeed.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/scope/ActivityFeed.tsx src/components/scope/FeedEvent.tsx \
        src/components/scope/ActivityFeed.test.tsx
git commit -m "feat(scope): ActivityFeed + FeedEvent components"
```

---

## Task 8: StatusStrip component

**Files:**
- Create: `src/components/scope/StatusStrip.tsx`
- Create: `src/components/scope/StatusStrip.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/scope/StatusStrip.test.tsx
import { render, screen } from "@testing-library/react";
import { StatusStrip } from "./StatusStrip";

const actuals = [
  { department_id: "d1", department_name: "Dev", total_hours: 22, estimated_hours: 60 },
  { department_id: "d2", department_name: "Design", total_hours: 18, estimated_hours: 40 },
];

describe("StatusStrip", () => {
  it("renders total hours used and estimated", () => {
    render(
      <StatusStrip
        actuals={actuals as any}
        quoteTotalCents={4850000}
        quoteStatus="sent"
        briefCount={3}
      />
    );
    expect(screen.getByText(/40h used/)).toBeInTheDocument();
    expect(screen.getByText(/100h estimated/)).toBeInTheDocument();
  });

  it("renders quote total and status", () => {
    render(
      <StatusStrip
        actuals={actuals as any}
        quoteTotalCents={4850000}
        quoteStatus="sent"
        briefCount={3}
      />
    );
    expect(screen.getByText(/R48,500/)).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
  });

  it("renders brief count", () => {
    render(
      <StatusStrip
        actuals={actuals as any}
        quoteTotalCents={4850000}
        quoteStatus="sent"
        briefCount={3}
      />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/components/scope/StatusStrip.test.tsx
```

Expected: FAIL — component not found.

- [ ] **Step 3: Implement `StatusStrip`**

```tsx
// src/components/scope/StatusStrip.tsx
import { cn } from "@/lib/utils";

interface Actual {
  department_id: string;
  department_name?: string;
  total_hours?: number;
  estimated_hours?: number;
}

interface Props {
  actuals: Actual[];
  quoteTotalCents?: number;
  quoteStatus?: string;
  briefCount?: number;
}

function formatZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    cents / 100
  );
}

const quoteStatusColor: Record<string, string> = {
  draft: "bg-m-surface-container text-m-on-surface-variant",
  sent: "bg-amber-100 text-amber-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export function StatusStrip({ actuals, quoteTotalCents, quoteStatus, briefCount }: Props) {
  const totalUsed = actuals.reduce((s, a) => s + (a.total_hours ?? 0), 0);
  const totalEstimated = actuals.reduce((s, a) => s + (a.estimated_hours ?? 0), 0);
  const pct = totalEstimated > 0 ? Math.min((totalUsed / totalEstimated) * 100, 100) : 0;

  return (
    <aside className="flex flex-col gap-6 border-l border-m-outline-variant bg-m-surface p-5">
      {/* Burn */}
      <section>
        <h3 className="mb-2 text-label-large text-m-on-surface">Budget</h3>
        <p className="text-label-small text-m-on-surface-variant">
          {totalUsed}h used / {totalEstimated}h estimated
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-m-surface-container">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-green-500"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {actuals.map((a) => (
            <div key={a.department_id} className="flex items-center justify-between">
              <span className="text-label-small text-m-on-surface-variant">
                {a.department_name ?? "Dept"}
              </span>
              <span className="text-label-small text-m-on-surface">
                {a.total_hours ?? 0}h / {a.estimated_hours ?? 0}h
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Briefs */}
      <section>
        <h3 className="mb-2 text-label-large text-m-on-surface">Briefs</h3>
        <p className="text-display-small text-m-on-surface">{briefCount ?? 0}</p>
        <p className="text-label-small text-m-on-surface-variant">linked threads</p>
      </section>

      {/* Quote */}
      {quoteTotalCents !== undefined && (
        <section>
          <h3 className="mb-2 text-label-large text-m-on-surface">Quote</h3>
          <p className="text-body-large font-medium text-m-on-surface">
            {formatZAR(quoteTotalCents)}
          </p>
          {quoteStatus && (
            <span
              className={cn(
                "mt-1 inline-block rounded px-2 py-0.5 text-label-small",
                quoteStatusColor[quoteStatus] ?? "bg-m-surface-container text-m-on-surface-variant"
              )}
            >
              {quoteStatus}
            </span>
          )}
        </section>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/scope/StatusStrip.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/scope/StatusStrip.tsx src/components/scope/StatusStrip.test.tsx
git commit -m "feat(scope): StatusStrip — burn, brief count, quote status"
```

---

## Task 9: ProjectScopeView page

**Files:**
- Create: `src/pages/ProjectScopeView.tsx`
- Create: `src/pages/ProjectScopeView.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/pages/ProjectScopeView.test.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { vi } from "vitest";

vi.mock("@/hooks/useClientProjects", () => ({
  useClientProjects: () => ({
    data: [
      {
        id: "client-1",
        name: "ACME",
        projects: [
          {
            id: "proj-1",
            name: "Website Rebuild",
            engagement_type: "fixed",
            status: "on_track",
            client_id: "client-1",
            quote_id: "quote-1",
          },
        ],
      },
    ],
  }),
}));

vi.mock("@/hooks/useProjectActivity", () => ({
  useProjectActivity: () => ({
    data: [],
    isLoading: false,
    isSuccess: true,
  }),
}));

vi.mock("@/hooks/useProject", () => ({
  useProject: () => ({
    data: {
      project: {
        id: "proj-1",
        name: "Website Rebuild",
        quote_id: "quote-1",
        client_id: "client-1",
      },
      actuals: [],
    },
    isLoading: false,
  }),
}));

import { ProjectScopeView } from "./ProjectScopeView";

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/client-1/projects/proj-1"]}>
        <Routes>
          <Route path="/clients/:clientId/projects/:projectId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ProjectScopeView", () => {
  it("renders the project name in the header", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByText("Website Rebuild")).toBeInTheDocument();
  });

  it("renders the client name breadcrumb", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByText("ACME")).toBeInTheDocument();
  });

  it("renders Activity tab by default", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByRole("tab", { name: /Activity/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("shows engagement type chip", () => {
    render(<ProjectScopeView />, { wrapper: Wrapper });
    expect(screen.getByText("fixed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/pages/ProjectScopeView.test.tsx
```

Expected: FAIL — component not found.

- [ ] **Step 3: Implement `ProjectScopeView`**

```tsx
// src/pages/ProjectScopeView.tsx
import { Link, useParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronRight } from "lucide-react";
import { useProject } from "@/hooks/useProjects";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useProjectActivity } from "@/hooks/useProjectActivity";
import { useInboxBriefs } from "@/hooks/useInboxBriefs";
import { ActivityFeed } from "@/components/scope/ActivityFeed";
import { StatusStrip } from "@/components/scope/StatusStrip";

export function ProjectScopeView() {
  const { clientId, projectId } = useParams<{ clientId: string; projectId: string }>();

  const { data: clientsData = [] } = useClientProjects();
  const client = clientsData.find((c) => c.id === clientId);
  const projectMeta = client?.projects.find((p) => p.id === projectId);

  const { data: projectData, isLoading: projectLoading } = useProject(projectId);
  const project = projectData?.project;
  const actuals = projectData?.actuals ?? [];

  const { data: events = [], isLoading: activityLoading } = useProjectActivity(
    projectId,
    project?.quote_id ?? undefined
  );

  const { data: inboxBriefs = [] } = useInboxBriefs();
  const linkedBriefCount = events.filter((e) => e.type === "brief").length;

  const engagementType = projectMeta?.engagement_type ?? project?.engagement_type ?? "fixed";
  const projectStatus = projectMeta?.status ?? "on_track";
  const projectName = project?.name ?? projectMeta?.name ?? "Project";
  const clientName = client?.name ?? "Client";

  if (projectLoading) {
    return (
      <div className="flex h-full items-center justify-center text-body-medium text-m-on-surface-variant">
        Loading…
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[1fr_280px]">
      {/* Centre pane */}
      <div className="flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-m-outline-variant bg-m-surface px-6 py-4">
          <Link
            to={`/clients/${clientId}`}
            className="text-body-medium text-m-on-surface-variant hover:text-m-on-surface transition-colors"
          >
            {clientName}
          </Link>
          <ChevronRight className="h-4 w-4 text-m-on-surface-variant" />
          <span className="text-body-medium text-m-on-surface">{projectName}</span>
          <span className="ml-2 rounded px-2 py-0.5 text-label-small bg-m-surface-container text-m-on-surface-variant">
            {engagementType}
          </span>
          <span
            className={
              projectStatus === "on_track"
                ? "ml-auto rounded-full px-2 py-0.5 text-label-small bg-green-100 text-green-800"
                : projectStatus === "needs_attention"
                ? "ml-auto rounded-full px-2 py-0.5 text-label-small bg-amber-100 text-amber-800"
                : "ml-auto rounded-full px-2 py-0.5 text-label-small bg-red-100 text-red-800"
            }
          >
            {projectStatus.replace("_", " ")}
          </span>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="activity" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="shrink-0 justify-start rounded-none border-b border-m-outline-variant bg-m-surface px-6">
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="quote">Quote / SOW</TabsTrigger>
            <TabsTrigger value="time">Time</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="flex-1 overflow-auto">
            <ActivityFeed events={events} isLoading={activityLoading} />
          </TabsContent>

          <TabsContent value="tasks" className="flex-1 overflow-auto p-6">
            <p className="text-body-medium text-m-on-surface-variant">
              ClickUp tasks sync coming in next phase.
            </p>
          </TabsContent>

          <TabsContent value="quote" className="flex-1 overflow-auto p-6">
            <p className="text-body-medium text-m-on-surface-variant">
              {project?.quote_id
                ? `Quote linked: ${project.quote_id}`
                : "No quote linked to this project yet."}
            </p>
          </TabsContent>

          <TabsContent value="time" className="flex-1 overflow-auto p-6">
            <p className="text-body-medium text-m-on-surface-variant">
              Time breakdown by department.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      {/* Right pane */}
      <StatusStrip
        actuals={actuals as any}
        quoteTotalCents={undefined}
        quoteStatus={undefined}
        briefCount={linkedBriefCount}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/pages/ProjectScopeView.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Type check the whole project**

```bash
npx tsc --noEmit
```

Fix any type errors before committing.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectScopeView.tsx src/pages/ProjectScopeView.test.tsx
git commit -m "feat(pages): ProjectScopeView — three-pane client/project scope view"
```

---

## Task 10: InboxAssignModal + wire up

**Files:**
- Create: `src/components/scope/InboxAssignModal.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/scope/InboxAssignModal.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { vi } from "vitest";

const mockMutateAsync = vi.fn().mockResolvedValue({});

vi.mock("@/hooks/useAssignBriefToProject", () => ({
  useAssignBriefToProject: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

vi.mock("@/hooks/useClientProjects", () => ({
  useClientProjects: () => ({
    data: [
      {
        id: "client-1",
        name: "ACME",
        projects: [{ id: "proj-1", name: "Website Rebuild", engagement_type: "fixed" }],
      },
    ],
  }),
}));

import { InboxAssignModal } from "./InboxAssignModal";

const brief = {
  id: "brief-1",
  raw_subject: "Can we add a blog?",
  sender_email: "sarah@acme.co.za",
  intent_type: "project_thread",
  created_at: "2026-05-09T10:00:00Z",
} as any;

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("InboxAssignModal", () => {
  it("renders brief subject", () => {
    render(<InboxAssignModal brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("Can we add a blog?")).toBeInTheDocument();
  });

  it("renders intent type badge", () => {
    render(<InboxAssignModal brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("Project thread")).toBeInTheDocument();
  });

  it("lists clients and projects in the select", () => {
    render(<InboxAssignModal brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("ACME — Website Rebuild")).toBeInTheDocument();
  });

  it("calls mutateAsync with selected project on assign", async () => {
    render(<InboxAssignModal brief={brief} open onClose={() => {}} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText("ACME — Website Rebuild"));
    fireEvent.click(screen.getByRole("button", { name: /Assign to project/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        briefId: "brief-1",
        projectId: "proj-1",
      })
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/components/scope/InboxAssignModal.test.tsx
```

Expected: FAIL — component not found.

- [ ] **Step 3: Implement `InboxAssignModal`**

```tsx
// src/components/scope/InboxAssignModal.tsx
import { useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useAssignBriefToProject } from "@/hooks/useAssignBriefToProject";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const intentLabels: Record<string, string> = {
  new_brief: "New brief",
  project_thread: "Project thread",
  retainer_thread: "Retainer thread",
  general_query: "Query",
  quick_response: "Quick response",
};

interface Props {
  brief: Brief;
  open: boolean;
  onClose: () => void;
}

export function InboxAssignModal({ brief, open, onClose }: Props) {
  const { data: clients = [] } = useClientProjects();
  const { mutateAsync, isPending } = useAssignBriefToProject();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const allProjects = clients.flatMap((c) =>
    c.projects.map((p) => ({ ...p, clientName: c.name }))
  );

  async function handleAssign() {
    if (!selectedProjectId) return;
    try {
      await mutateAsync({ briefId: brief.id, projectId: selectedProjectId });
      toast.success("Brief linked to project");
      onClose();
    } catch {
      toast.error("Failed to assign brief");
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] max-w-full">
        <SheetHeader className="mb-6">
          <SheetTitle>{brief.raw_subject ?? "(no subject)"}</SheetTitle>
          <SheetDescription>
            From {brief.sender_email}
            {brief.intent_type && (
              <span className="ml-2 rounded px-2 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
                {intentLabels[brief.intent_type] ?? brief.intent_type}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mb-6">
          <h3 className="mb-2 text-label-large text-m-on-surface">Assign to project</h3>
          <div className="flex flex-col gap-1.5">
            {allProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-4 py-3 text-left text-body-medium transition-colors",
                  selectedProjectId === p.id
                    ? "border-m-primary bg-m-primary-container text-m-on-primary-container"
                    : "border-m-outline-variant bg-m-surface text-m-on-surface hover:bg-m-surface-container"
                )}
              >
                <span>{p.clientName} — {p.name}</span>
                <span className="ml-auto text-label-small opacity-60">{p.engagement_type}</span>
              </button>
            ))}
            {allProjects.length === 0 && (
              <p className="text-body-small text-m-on-surface-variant">
                No active projects found. Create a project first.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={handleAssign}
            disabled={!selectedProjectId || isPending}
            className="flex-1"
          >
            {isPending ? "Assigning…" : "Assign to project"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/scope/InboxAssignModal.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Full test suite check**

```bash
npx vitest run
```

Expected: All tests pass. No regressions in existing tests.

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/scope/InboxAssignModal.tsx src/components/scope/InboxAssignModal.test.tsx
git commit -m "feat(scope): InboxAssignModal — review and assign unlinked inbox briefs to projects"
```

---

## Self-review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Three-tier Client > Project > Thread | Tasks 5, 6, 9 |
| Left sidebar — client headers, project rows, inbox | Tasks 5, 6 |
| Status dot with colour coding | Task 5 (ProjectNavRow) |
| Engagement type chip (fixed/retainer) | Tasks 5, 9 |
| Centre pane — activity feed with event types | Tasks 7, 9 |
| Activity tab default | Task 9 |
| Tasks / Quote / Time tabs | Task 9 (stub tabs, wired for future content) |
| Right pane — burn, brief count, quote | Task 8 |
| URL-based navigation `/clients/:id/projects/:id` | Task 6 |
| Inbox section — unlinked briefs | Tasks 4, 5 |
| Inbox assign modal — project select + confirm | Task 10 |
| Data model — `client_id`, `engagement_type`, `status`, `parent_project_id` | Task 1 |
| Existing pages remain accessible | Task 6 (AppShell extension, not replacement) |

**No placeholders found.**

**Type consistency verified:** `ActivityEvent` defined in Task 3, consumed in Tasks 7 and 9. `ClientWithProjects` defined in Task 2, consumed in Tasks 5 and 9. `Brief` from `Database` type used consistently across Tasks 4, 5, 10. `useProject` from existing `useProjects.ts` consumed in Task 9 — no new hook needed.
