# Inbox Client/Contact Filter Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible client/contact filter panel to the left of the Inbox page so briefs can be narrowed by company or individual sender.

**Architecture:** Filter state lives in `Inbox.tsx`; a new `useInboxFilterTree` hook builds the client/contact tree for the sidebar; `useBriefs` is extended with optional `filterOptions` that push `.eq()` / `.is()` conditions into the Supabase query; `InboxFilterPanel` is a pure presentational component driven entirely by props.

**Tech Stack:** React 18, TypeScript, TanStack Query, Supabase JS, Tailwind + M3 tokens, Vitest + @testing-library/react

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/hooks/useBriefs.ts` | Add optional `filterOptions` param to `useBriefs` |
| Create | `src/hooks/useInboxFilterTree.ts` | Fetch + group brief counts into client/contact tree |
| Create | `src/hooks/useInboxFilterTree.test.ts` | Unit tests for `useInboxFilterTree` |
| Create | `src/components/InboxFilterPanel.tsx` | Filter sidebar — collapsible client rows + Unassigned section |
| Modify | `src/components/BriefList.tsx` | Accept + forward `filterOptions` to `useBriefs` |
| Modify | `src/pages/Inbox.tsx` | Own filter state, two-column layout, heading breadcrumb |

---

## Task 1: Extend `useBriefs` with filter options

**Files:**
- Modify: `src/hooks/useBriefs.ts`

- [ ] **Step 1.1: Add the `BriefFilterOptions` type and extend the hook signature**

Replace the existing `useBriefs` export in `src/hooks/useBriefs.ts` with:

```ts
export type BriefFilterOptions = {
  clientId?: string | null;   // undefined = no filter; null = unassigned only
  contactEmail?: string;
};

export function useBriefs(
  scope: BriefScope = "all",
  currentUserId?: string | null,
  filterOptions?: BriefFilterOptions,
) {
  return useQuery({
    queryKey: [
      "briefs",
      scope,
      currentUserId ?? "anon",
      filterOptions?.clientId ?? "any",
      filterOptions?.contactEmail ?? "any",
    ],
    queryFn: async (): Promise<Brief[]> => {
      let q = supabase
        .from("briefs")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("received_at", { ascending: false });

      if (scope === "mine") {
        if (!currentUserId) return [];
        q = q.eq("assignee_id", currentUserId);
      } else if (scope === "unassigned") {
        q = q.is("assignee_id", null).not("status", "in", '("accepted","rejected","archived","spam")');
      } else if (scope === "waiting") {
        q = q.eq("status", "needs_info");
      }

      if (filterOptions?.clientId !== undefined) {
        if (filterOptions.clientId === null) {
          q = q.is("client_id", null);
        } else {
          q = q.eq("client_id", filterOptions.clientId);
        }
      }
      if (filterOptions?.contactEmail !== undefined) {
        q = q.eq("sender_email", filterOptions.contactEmail);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 1.2: Run the existing tests to confirm nothing broke**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
npx vitest run src/hooks/useBriefs
```

Expected: 0 failures (there are no existing `useBriefs` tests — that's fine, command exits 0 with "no test files found").

- [ ] **Step 1.3: Commit**

```bash
git add src/hooks/useBriefs.ts
git commit -m "feat(briefs): extend useBriefs with optional clientId/contactEmail filter options"
```

---

## Task 2: Create `useInboxFilterTree` hook

**Files:**
- Create: `src/hooks/useInboxFilterTree.ts`
- Create: `src/hooks/useInboxFilterTree.test.ts`

The hook fetches two things in parallel: all inbox briefs (only `client_id` + `sender_email` fields) and all clients (id + name). It groups them client-side to produce the tree.

- [ ] **Step 2.1: Write the failing test**

Create `src/hooks/useInboxFilterTree.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mocked at module level — overridden per-test via vi.mocked()
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { useInboxFilterTree } from "./useInboxFilterTree";
import { supabase } from "@/lib/supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const BRIEFS = [
  { client_id: "c1", sender_email: "alice@acme.co.za" },
  { client_id: "c1", sender_email: "alice@acme.co.za" },
  { client_id: "c1", sender_email: "bob@acme.co.za" },
  { client_id: null,  sender_email: "unknown@example.com" },
  { client_id: null,  sender_email: null },
];
const CLIENTS = [{ id: "c1", name: "ACME Corp" }];

beforeEach(() => {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "briefs") {
      return {
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ data: BRIEFS, error: null }),
        }),
      } as any;
    }
    if (table === "clients") {
      return {
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: CLIENTS, error: null }),
          }),
        }),
      } as any;
    }
    return {} as any;
  });
});

describe("useInboxFilterTree", () => {
  it("groups briefs into clients with contact lists", async () => {
    const { result } = renderHook(() => useInboxFilterTree(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const tree = result.current.data!;
    expect(tree.clients).toHaveLength(1);
    expect(tree.clients[0].id).toBe("c1");
    expect(tree.clients[0].name).toBe("ACME Corp");
    expect(tree.clients[0].count).toBe(3);
    expect(tree.clients[0].contacts).toHaveLength(2);

    const alice = tree.clients[0].contacts.find((c) => c.email === "alice@acme.co.za");
    expect(alice?.count).toBe(2);
    const bob = tree.clients[0].contacts.find((c) => c.email === "bob@acme.co.za");
    expect(bob?.count).toBe(1);
  });

  it("counts unassigned briefs (null client_id)", async () => {
    const { result } = renderHook(() => useInboxFilterTree(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.unassigned.count).toBe(2);
  });

  it("excludes null sender_email from contact rows but still counts in client total", async () => {
    const { result } = renderHook(() => useInboxFilterTree(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const acme = result.current.data!.clients[0];
    const nullContact = acme.contacts.find((c) => c.email === null);
    expect(nullContact).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run the test to confirm it fails**

```bash
npx vitest run src/hooks/useInboxFilterTree.test.ts
```

Expected: FAIL — "Cannot find module './useInboxFilterTree'"

- [ ] **Step 2.3: Implement `useInboxFilterTree`**

Create `src/hooks/useInboxFilterTree.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type FilterContact = { email: string; count: number };
export type FilterClient = {
  id: string;
  name: string;
  count: number;
  contacts: FilterContact[];
};
export type FilterTree = {
  clients: FilterClient[];
  unassigned: { count: number };
};

export function useInboxFilterTree() {
  return useQuery({
    queryKey: ["inbox-filter-tree"],
    queryFn: async (): Promise<FilterTree> => {
      const [briefsResult, clientsResult] = await Promise.all([
        supabase
          .from("briefs")
          .select("client_id, sender_email")
          .is("parent_project_id", null),
        supabase
          .from("clients")
          .select("id, name")
          .is("archived_at", null)
          .order("name"),
      ]);

      if (briefsResult.error) throw briefsResult.error;
      if (clientsResult.error) throw clientsResult.error;

      const briefs = briefsResult.data ?? [];
      const clientRows = clientsResult.data ?? [];

      // Build a lookup: clientId → { totalCount, contacts: Map<email, count> }
      const clientMap = new Map<
        string,
        { count: number; contacts: Map<string, number> }
      >();
      let unassignedCount = 0;

      for (const b of briefs) {
        if (b.client_id === null) {
          unassignedCount++;
          continue;
        }
        if (!clientMap.has(b.client_id)) {
          clientMap.set(b.client_id, { count: 0, contacts: new Map() });
        }
        const entry = clientMap.get(b.client_id)!;
        entry.count++;
        if (b.sender_email) {
          entry.contacts.set(
            b.sender_email,
            (entry.contacts.get(b.sender_email) ?? 0) + 1,
          );
        }
      }

      const clients: FilterClient[] = clientRows
        .filter((c) => clientMap.has(c.id))
        .map((c) => {
          const entry = clientMap.get(c.id)!;
          const contacts: FilterContact[] = Array.from(
            entry.contacts.entries(),
          )
            .map(([email, count]) => ({ email, count }))
            .sort((a, b) => b.count - a.count);
          return { id: c.id, name: c.name, count: entry.count, contacts };
        });

      return { clients, unassigned: { count: unassignedCount } };
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2.4: Run the test to confirm it passes**

```bash
npx vitest run src/hooks/useInboxFilterTree.test.ts
```

Expected: PASS — 3 tests

- [ ] **Step 2.5: Commit**

```bash
git add src/hooks/useInboxFilterTree.ts src/hooks/useInboxFilterTree.test.ts
git commit -m "feat(inbox): add useInboxFilterTree hook for client/contact grouping"
```

---

## Task 3: Create `InboxFilterPanel` component

**Files:**
- Create: `src/components/InboxFilterPanel.tsx`

This is a purely presentational component. No data fetching — receives the tree and active filter via props and fires callbacks.

- [ ] **Step 3.1: Create `src/components/InboxFilterPanel.tsx`**

```tsx
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { FilterTree } from "@/hooks/useInboxFilterTree";

interface InboxFilterPanelProps {
  tree: FilterTree;
  activeClientId?: string | null;
  activeContactEmail?: string;
  onSelectAll: () => void;
  onSelectClient: (clientId: string) => void;
  onSelectContact: (clientId: string, email: string) => void;
  onSelectUnassigned: () => void;
}

export function InboxFilterPanel({
  tree,
  activeClientId,
  activeContactEmail,
  onSelectAll,
  onSelectClient,
  onSelectContact,
  onSelectUnassigned,
}: InboxFilterPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleSelectClient(clientId: string) {
    setExpandedIds(new Set([clientId]));
    onSelectClient(clientId);
  }

  const noneActive = activeClientId === undefined && activeContactEmail === undefined;
  const unassignedActive = activeClientId === null;

  return (
    <div className="flex w-48 flex-shrink-0 flex-col border-r border-m-outline-variant bg-[#f7f7fb]">
      <div className="px-3 pb-2 pt-3.5 text-[10px] font-bold uppercase tracking-[0.6px] text-m-on-surface-variant">
        Filter by client
      </div>

      {/* All clients */}
      <button
        onClick={onSelectAll}
        className={`px-3 py-1.5 text-left text-xs transition-colors hover:bg-m-surface-container-high ${
          noneActive ? "font-semibold text-m-primary" : "text-m-on-surface-variant"
        }`}
      >
        All clients
      </button>

      {/* Client rows */}
      <div className="flex-1 overflow-y-auto">
        {tree.clients.map((client) => {
          const isClientActive = activeClientId === client.id;
          const isExpanded = expandedIds.has(client.id);

          return (
            <div key={client.id} className="mt-0.5">
              {/* Client header row */}
              <div
                className={`flex items-center gap-1.5 border-l-2 transition-colors ${
                  isClientActive
                    ? "border-m-primary bg-m-primary-container/30"
                    : "border-transparent"
                }`}
              >
                {/* Chevron — toggles expand only */}
                <button
                  onClick={() => toggleExpand(client.id)}
                  className="flex-shrink-0 pl-2 pr-0.5 py-1.5 text-m-on-surface-variant hover:text-m-on-surface"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>

                {/* Client name — filters */}
                <button
                  onClick={() => handleSelectClient(client.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-3 text-left"
                >
                  <span
                    className={`truncate text-xs ${
                      isClientActive ? "font-semibold text-m-on-surface" : "text-m-on-surface-variant"
                    }`}
                  >
                    {client.name}
                  </span>
                  <span
                    className={`flex-shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold ${
                      isClientActive
                        ? "bg-m-primary text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {client.count}
                  </span>
                </button>
              </div>

              {/* Contact rows */}
              {isExpanded && client.contacts.length > 0 && (
                <div className="pb-1">
                  {client.contacts.map((contact) => {
                    const isContactActive =
                      isClientActive && activeContactEmail === contact.email;
                    return (
                      <button
                        key={contact.email}
                        onClick={() => onSelectContact(client.id, contact.email)}
                        className={`flex w-full items-center justify-between gap-2 py-1 pl-8 pr-3 text-left transition-colors ${
                          isContactActive
                            ? "bg-m-primary-container/50"
                            : "hover:bg-m-surface-container-high"
                        }`}
                      >
                        <span
                          className={`min-w-0 truncate text-[10px] ${
                            isContactActive
                              ? "font-medium text-m-on-surface"
                              : "text-m-on-surface-variant"
                          }`}
                        >
                          {contact.email}
                        </span>
                        <span
                          className={`flex-shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold ${
                            isContactActive
                              ? "bg-m-primary text-white"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {contact.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unassigned — pinned at bottom */}
      {tree.unassigned.count > 0 && (
        <button
          onClick={onSelectUnassigned}
          className={`flex items-center gap-2 border-t px-3 py-2 text-left transition-colors ${
            unassignedActive
              ? "border-red-200 bg-red-100"
              : "border-red-100 bg-red-50 hover:bg-red-100"
          }`}
        >
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-destructive" />
          <span className="flex-1 text-xs font-semibold text-destructive">Unassigned</span>
          <span className="rounded-full bg-destructive px-1.5 py-px text-[9px] font-semibold text-white">
            {tree.unassigned.count}
          </span>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/components/InboxFilterPanel.tsx
git commit -m "feat(inbox): add InboxFilterPanel component"
```

---

## Task 4: Update `BriefList` to accept and forward filter options

**Files:**
- Modify: `src/components/BriefList.tsx`

- [ ] **Step 4.1: Add `filterOptions` to `BriefListProps` and forward to `useBriefs`**

In `src/components/BriefList.tsx`, update the props interface and `useBriefs` call:

```tsx
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useBriefs, type BriefScope, type BriefFilterOptions } from "@/hooks/useBriefs";
import { STATUS_LABEL } from "@/lib/brief-routing";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

type IntentType = "new_brief" | "project_thread" | "retainer_thread" | "general_query" | "quick_response";

const INTENT_LABEL: Record<IntentType, string> = {
  new_brief: "NEW",
  project_thread: "PROJECT",
  retainer_thread: "RETAINER",
  general_query: "QUERY",
  quick_response: "QUICK",
};

const INTENT_CLASS: Record<IntentType, string> = {
  new_brief: "bg-blue-100 text-blue-800",
  project_thread: "bg-purple-100 text-purple-800",
  retainer_thread: "bg-orange-100 text-orange-800",
  general_query: "bg-gray-100 text-gray-700",
  quick_response: "bg-green-100 text-green-800",
};

function IntentBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-label-small text-gray-400">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300" />
        pending
      </span>
    );
  }
  const cls = INTENT_CLASS[type as IntentType] ?? "bg-gray-100 text-gray-700";
  const label = INTENT_LABEL[type as IntentType] ?? type;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-small font-medium ${cls}`}>
      {label}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-ZA");
}

const EMPTY: Record<BriefScope, string> = {
  mine: "No briefs assigned to you.",
  unassigned: "All briefs are assigned.",
  waiting: "No briefs awaiting client response.",
  all: "No briefs yet.",
};

interface BriefListProps {
  scope: BriefScope;
  currentUserId?: string | null;
  selectedBriefId?: string;
  filterOptions?: BriefFilterOptions;
}

export function BriefList({ scope, currentUserId, selectedBriefId, filterOptions }: BriefListProps) {
  const { data: briefs = [], isLoading } = useBriefs(scope, currentUserId, filterOptions);

  if (isLoading) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">Loading…</div>;
  }
  if (briefs.length === 0) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">{EMPTY[scope]}</div>;
  }

  return (
    <div className="space-y-2">
      {briefs.map((b: Brief) => (
        <Link key={b.id} to={`/inbox/${b.id}`} className="block">
          <Card
            className={`transition-colors hover:bg-m-surface-container ${
              selectedBriefId === b.id ? "ring-2 ring-m-primary" : ""
            }`}
          >
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-title-small">
                  {b.raw_subject ?? "(no subject)"}
                </div>
                <div className="text-label-small text-m-on-surface-variant">
                  {b.sender_email ?? "manual"}
                  {b.message_count > 0 &&
                    ` · ${b.message_count} msg${b.message_count !== 1 ? "s" : ""}`}
                  {b.last_message_at && ` · ${relativeTime(b.last_message_at)}`}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <IntentBadge type={b.intent_type ?? null} />
                <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 4.2: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `BriefList` or `useBriefs`.

- [ ] **Step 4.3: Commit**

```bash
git add src/components/BriefList.tsx
git commit -m "feat(inbox): forward filterOptions from BriefList to useBriefs"
```

---

## Task 5: Update `Inbox.tsx` — filter state + two-column layout

**Files:**
- Modify: `src/pages/Inbox.tsx`

- [ ] **Step 5.1: Rewrite `Inbox.tsx` with filter state, panel, and two-column layout**

```tsx
import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefList } from "@/components/BriefList";
import { BriefConversation } from "@/components/BriefConversation";
import { InboxFilterPanel } from "@/components/InboxFilterPanel";
import { useBrief } from "@/hooks/useBriefs";
import { useInboxFilterTree } from "@/hooks/useInboxFilterTree";
import { useCurrentUserId } from "@/context/AuthContext";
import type { BriefScope, BriefFilterOptions } from "@/hooks/useBriefs";

const SCOPES: BriefScope[] = ["mine", "unassigned", "waiting", "all"];

const TAB_LABEL: Record<BriefScope, string> = {
  mine: "Mine",
  unassigned: "Unassigned",
  waiting: "Waiting",
  all: "All",
};

export function Inbox() {
  const { briefId } = useParams<{ briefId?: string }>();
  const currentUserId = useCurrentUserId();
  const navigate = useNavigate();
  const { data: selectedBrief } = useBrief(briefId);
  const { data: filterTree } = useInboxFilterTree();

  const defaultTab: BriefScope = currentUserId ? "mine" : "all";

  // undefined = no filter; null = unassigned; string = specific client
  const [activeClientId, setActiveClientId] = useState<string | null | undefined>(undefined);
  const [activeContactEmail, setActiveContactEmail] = useState<string | undefined>(undefined);

  function handleSelectAll() {
    setActiveClientId(undefined);
    setActiveContactEmail(undefined);
  }

  function handleSelectClient(clientId: string) {
    setActiveClientId(clientId);
    setActiveContactEmail(undefined);
  }

  function handleSelectContact(clientId: string, email: string) {
    setActiveClientId(clientId);
    setActiveContactEmail(email);
  }

  function handleSelectUnassigned() {
    setActiveClientId(null);
    setActiveContactEmail(undefined);
  }

  const filterOptions: BriefFilterOptions | undefined =
    activeClientId !== undefined || activeContactEmail !== undefined
      ? { clientId: activeClientId, contactEmail: activeContactEmail }
      : undefined;

  // Heading breadcrumb
  const filterLabel = activeContactEmail
    ? activeContactEmail
    : activeClientId === null
    ? "Unassigned"
    : activeClientId !== undefined && filterTree
    ? filterTree.clients.find((c) => c.id === activeClientId)?.name
    : undefined;

  return (
    <div className="flex h-full">
      {/* Filter panel */}
      {filterTree && (
        <InboxFilterPanel
          tree={filterTree}
          activeClientId={activeClientId}
          activeContactEmail={activeContactEmail}
          onSelectAll={handleSelectAll}
          onSelectClient={handleSelectClient}
          onSelectContact={handleSelectContact}
          onSelectUnassigned={handleSelectUnassigned}
        />
      )}

      {/* Main content */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-end justify-between">
          <h1 className="text-headline-medium">
            Inbox
            {filterLabel && (
              <span className="ml-2 text-title-medium text-m-primary">· {filterLabel}</span>
            )}
          </h1>
          <Button asChild>
            <Link to="/briefs/new">
              <Plus className="h-4 w-4" /> New brief
            </Link>
          </Button>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="mb-4">
            {SCOPES.map((scope) => (
              <TabsTrigger key={scope} value={scope}>
                {TAB_LABEL[scope]}
              </TabsTrigger>
            ))}
          </TabsList>

          {SCOPES.map((scope) => (
            <TabsContent key={scope} value={scope}>
              <BriefList
                scope={scope}
                currentUserId={currentUserId}
                selectedBriefId={briefId}
                filterOptions={filterOptions}
              />
            </TabsContent>
          ))}
        </Tabs>

        {selectedBrief && (
          <BriefConversation
            brief={selectedBrief}
            open={!!briefId}
            onClose={() => navigate("/inbox")}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 5.3: Run all tests**

```bash
npx vitest run
```

Expected: all existing tests pass.

- [ ] **Step 5.4: Start the dev server and manually test**

```bash
npm run dev
```

Open `http://localhost:5174/inbox` and verify:
- Filter panel appears to the left of the brief list
- Clicking a client name filters the list and auto-expands contacts
- Clicking a contact further narrows to that sender
- Clicking the chevron toggles expansion without changing the filter
- "All clients" resets to the full list
- Unassigned section appears in red at the bottom (if any briefs with no client)
- The heading breadcrumb updates to show the active filter

- [ ] **Step 5.5: Commit**

```bash
git add src/pages/Inbox.tsx
git commit -m "feat(inbox): add client/contact filter panel with two-column layout"
```
