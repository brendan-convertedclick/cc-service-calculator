# Inbox v2 + Wiki-Context AI Scoping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Inbox with tabs + a conversation pane, then inject per-client wiki context into AI scope drafts.

**Architecture:** Phase 1 (gmail-relay, brief_messages, Apps Script) is already shipped. This plan covers Phase 2 — Inbox v2 UI (assignee model, 4-tab layout, per-brief conversation pane with interleaved internal notes) — then Phase 3 — wiki-context injection into the `draft-scope` Edge Function via the GitHub Contents API and auto-provisioning of new client wiki folders.

**Tech Stack:** Vite + React 18 + TypeScript + TanStack Query + Supabase JS + Radix Tabs + shadcn/ui Sheet + DOMPurify + Deno Edge Functions + Anthropic Claude.

---

## File Map

### Phase 2 — Created
- `supabase/migrations/0027_brief_assignee.sql` — adds `assignee_id` FK to `briefs`
- `src/hooks/useBriefMessages.ts` — fetches `brief_messages` + Realtime subscription
- `src/hooks/useBriefActions.ts` — `useUpdateBriefAssignee`, `useAddInternalNote`, `useBriefDownstream`
- `src/components/MessageItem.tsx` — three variants: inbound / outbound / note
- `src/components/AssigneePicker.tsx` — popover picker that writes to `briefs.assignee_id`
- `src/components/BriefList.tsx` — flat list of brief rows per tab, sorted by `last_message_at`
- `src/components/BriefConversation.tsx` — Sheet drawer showing message timeline + note form
- `src/components/MessageItem.test.tsx` — component tests for all three variants
- `src/components/BriefConversation.test.tsx` — test: renders messages + note submission

### Phase 2 — Modified
- `src/hooks/useBriefs.ts` — extend with `scope` param (`mine | unassigned | waiting | all`)
- `src/components/BriefRow.tsx` — add `message_count` badge + `last_message_at` relative time + remove expand logic (conversation moves to pane)
- `src/pages/Inbox.tsx` — full rewrite: 4 Radix Tabs + BriefConversation sheet
- `src/App.tsx` — add `/inbox/:briefId` route

### Phase 3 — Created
- `supabase/migrations/0028_clients_wiki_path.sql` — adds `wiki_path` to `clients`, `ai_context_snapshot` to `scopes`
- `supabase/functions/_shared/wiki-context.ts` — `loadClientWikiContext(client, pat, repo)` helper
- `supabase/functions/provision-client-wiki/index.ts` — Edge Function: PUT starter `index.md` to GitHub

### Phase 3 — Modified
- `supabase/functions/draft-scope/index.ts` — add wiki context fetch + snapshot write
- `src/hooks/useClients.ts` — fire-and-forget `provision-client-wiki` after client creation
- `src/pages/Clients.tsx` — add `wiki_path` edit field per client row

---

## Phase 2 — Inbox v2 UI

### Task 1: Migration — `assignee_id` on `briefs`

**Files:**
- Create: `supabase/migrations/0027_brief_assignee.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 0027_brief_assignee.sql
-- Phase 2 of Inbox v2: assignee model.

alter table public.briefs
  add column assignee_id uuid references public.team_members(id) on delete set null;

create index briefs_assignee_idx on public.briefs (assignee_id)
  where assignee_id is not null;
```

- [ ] **Step 2: Apply the migration**

```bash
# Use the cc-supabase MCP tool (not CLI) as per CLAUDE.md:
# mcp__cc-supabase__apply_migration with name="brief_assignee" and the SQL above
```

- [ ] **Step 3: Regenerate TypeScript types**

```bash
npx supabase gen types typescript \
  --project-id lpgwxacoqiqpcfpkklib \
  --schema public > src/types/db.ts
```

Expected: `src/types/db.ts` now contains `assignee_id: string | null` in the `briefs` Row/Insert/Update blocks.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0027_brief_assignee.sql src/types/db.ts
git commit -m "feat(db): add assignee_id to briefs (Phase 2)"
```

---

### Task 2: Install dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install DOMPurify**

```bash
npm install dompurify
npm install --save-dev @types/dompurify
```

- [ ] **Step 2: Add shadcn Sheet component**

```bash
npx shadcn@latest add sheet
```

Expected: `src/components/ui/sheet.tsx` now exists.

- [ ] **Step 3: Verify installs**

```bash
node -e "require('dompurify'); console.log('ok')"
ls src/components/ui/sheet.tsx
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/ui/sheet.tsx
git commit -m "chore: add dompurify + shadcn Sheet"
```

---

### Task 3: Extend `useBriefs` with scope filter

**Files:**
- Modify: `src/hooks/useBriefs.ts`

- [ ] **Step 1: Update `useBriefs` to accept a `scope` param**

Replace the existing `useBriefs` function (leave all other exports unchanged):

```ts
export type BriefScope = "mine" | "unassigned" | "waiting" | "all";

export function useBriefs(scope: BriefScope = "all", currentUserId?: string | null) {
  return useQuery({
    queryKey: ["briefs", scope, currentUserId ?? "anon"],
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
      // "all" — no additional filter

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 2: Run existing tests to ensure nothing broke**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBriefs.ts
git commit -m "feat(hooks): extend useBriefs with scope filter"
```

---

### Task 4: `useBriefMessages` hook

**Files:**
- Create: `src/hooks/useBriefMessages.ts`

- [ ] **Step 1: Create the hook**

```ts
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

export type BriefMessage = Database["public"]["Tables"]["brief_messages"]["Row"];

const KEY = (id: string) => ["brief_messages", id] as const;

export function useBriefMessages(briefId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    enabled: !!briefId,
    queryKey: briefId ? KEY(briefId) : ["brief_messages", "none"],
    queryFn: async (): Promise<BriefMessage[]> => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from("brief_messages")
        .select("*")
        .eq("brief_id", briefId)
        .order("sent_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    // Polling fallback if Realtime drops
    refetchInterval: 30_000,
  });

  // Realtime: invalidate on new inserts for this brief
  useEffect(() => {
    if (!briefId) return;
    const channel = supabase
      .channel(`brief_messages:${briefId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "brief_messages", filter: `brief_id=eq.${briefId}` },
        () => qc.invalidateQueries({ queryKey: KEY(briefId) }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [briefId, qc]);

  return query;
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all pass (no new tests yet — hook is tested indirectly via BriefConversation component test in Task 10).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBriefMessages.ts
git commit -m "feat(hooks): useBriefMessages with Realtime subscription"
```

---

### Task 5: Brief action hooks

**Files:**
- Create: `src/hooks/useBriefActions.ts`

- [ ] **Step 1: Create the file with three exports**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";

// ── Assignee ──────────────────────────────────────────────────────────────────

export function useUpdateBriefAssignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ briefId, assigneeId }: { briefId: string; assigneeId: string | null }) => {
      const { error } = await supabase
        .from("briefs")
        .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
        .eq("id", briefId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["briefs"] }),
  });
}

// ── Internal note ─────────────────────────────────────────────────────────────

export function useAddInternalNote(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, authorEmail }: { body: string; authorEmail: string }) => {
      const syntheticId = `note-${uuidv4()}`;
      const { error } = await supabase.from("brief_messages").insert({
        brief_id: briefId,
        gmail_message_id: syntheticId,
        direction: "note",
        body_text: body,
        relayed_by: authorEmail,
        sent_at: new Date().toISOString(),
        to_emails: [],
        cc_emails: [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brief_messages", briefId] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
    },
  });
}

// ── Downstream link ───────────────────────────────────────────────────────────

export type DownstreamLink =
  | { kind: "scope"; id: string; label: string }
  | { kind: "quote"; id: string; label: string }
  | { kind: "project"; id: string; label: string }
  | { kind: "none" };

export function useBriefDownstream(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: ["brief_downstream", briefId],
    queryFn: async (): Promise<DownstreamLink> => {
      if (!briefId) return { kind: "none" };

      // scope → brief
      const { data: scope } = await supabase
        .from("scopes")
        .select("id")
        .eq("brief_id", briefId)
        .maybeSingle();
      if (!scope) return { kind: "none" };

      // quote → scope
      const { data: quote } = await supabase
        .from("quotes")
        .select("id, status")
        .eq("scope_id", scope.id)
        .neq("status", "superseded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!quote) return { kind: "scope", id: scope.id, label: "Scope" };

      // project → quote
      const { data: project } = await supabase
        .from("projects")
        .select("id, name")
        .eq("quote_id", quote.id)
        .maybeSingle();
      if (project) return { kind: "project", id: project.id, label: project.name ?? "Project" };

      return { kind: "quote", id: quote.id, label: `Quote` };
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Check uuid is available**

```bash
grep '"uuid"' package.json
```

If missing:

```bash
npm install uuid && npm install --save-dev @types/uuid
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useBriefActions.ts package.json package-lock.json
git commit -m "feat(hooks): assignee, internal notes, and downstream link hooks"
```

---

### Task 6: `MessageItem.tsx` component + tests

**Files:**
- Create: `src/components/MessageItem.tsx`
- Create: `src/components/MessageItem.test.tsx`

- [ ] **Step 1: Write the failing tests first**

```tsx
// src/components/MessageItem.test.tsx
import { render, screen } from "@testing-library/react";
import { MessageItem } from "./MessageItem";
import type { BriefMessage } from "@/hooks/useBriefMessages";

const base: BriefMessage = {
  id: "msg-1",
  brief_id: "brief-1",
  gmail_message_id: "gm-1",
  direction: "inbound",
  from_email: "client@example.com",
  from_name: "Alice",
  to_emails: ["me@convertedclick.co.za"],
  cc_emails: [],
  subject: "Hello",
  body_text: "Plain body",
  body_html: null,
  attachments: [],
  sent_at: "2026-05-01T10:00:00Z",
  relayed_by: null,
  created_at: "2026-05-01T10:00:00Z",
};

describe("MessageItem", () => {
  it("renders inbound sender and text body", () => {
    render(<MessageItem message={base} />);
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText("Plain body")).toBeInTheDocument();
  });

  it("renders outbound aligned right", () => {
    render(<MessageItem message={{ ...base, direction: "outbound", relayed_by: "brendan@convertedclick.co.za" }} />);
    expect(screen.getByText(/brendan@convertedclick\.co\.za/)).toBeInTheDocument();
  });

  it("renders note variant with full-width style", () => {
    render(
      <MessageItem
        message={{
          ...base,
          direction: "note",
          gmail_message_id: "note-abc",
          body_text: "Internal note content",
          relayed_by: "brendan@convertedclick.co.za",
        }}
      />,
    );
    expect(screen.getByText("Internal note content")).toBeInTheDocument();
    expect(screen.getByText(/Internal note/)).toBeInTheDocument();
  });

  it("strips XSS from HTML body", () => {
    render(
      <MessageItem
        message={{ ...base, body_html: '<p>Safe</p><script>alert("xss")</script>', body_text: null }}
      />,
    );
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
    expect(screen.getByText("Safe")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -- MessageItem
```

Expected: FAIL — `MessageItem` not found.

- [ ] **Step 3: Implement `MessageItem.tsx`**

```tsx
import DOMPurify from "dompurify";
import type { BriefMessage } from "@/hooks/useBriefMessages";

const ALLOWED_TAGS = [
  "a","p","br","strong","em","u","ul","ol","li","blockquote","pre","code",
  "img","table","thead","tbody","tr","td","th",
];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, FORCE_BODY: true });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-ZA");
}

export function MessageItem({ message }: { message: BriefMessage }) {
  const { direction, from_email, from_name, body_html, body_text, sent_at, relayed_by, attachments } = message;

  const senderLabel = from_name ?? from_email ?? "Unknown";
  const time = relativeTime(sent_at);

  // Parse attachments JSON (stored as Json in db.ts)
  const files = Array.isArray(attachments)
    ? (attachments as { name: string; storage_path: string; mime: string; size: number }[])
    : [];

  if (direction === "note") {
    return (
      <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3">
        <div className="mb-1 text-label-small text-yellow-800">
          Internal note · {relayed_by ?? "team"} · {time}
        </div>
        <div className="text-body-medium text-yellow-900 whitespace-pre-wrap">{body_text}</div>
      </div>
    );
  }

  const isOutbound = direction === "outbound";

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-lg p-3 ${isOutbound ? "bg-m-primary-container" : "bg-m-surface-container"}`}>
        <div className={`mb-1 text-label-small text-m-on-surface-variant flex gap-2 ${isOutbound ? "justify-end" : "justify-start"}`}>
          <span>{isOutbound ? (relayed_by ?? "You") : senderLabel}</span>
          <span>·</span>
          <span>{time}</span>
        </div>

        {body_html ? (
          <div
            className="email-body text-body-medium"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: sanitize(body_html) }}
          />
        ) : (
          <div className="text-body-medium whitespace-pre-wrap">{body_text}</div>
        )}

        {files.length > 0 && (
          <div className="mt-2 space-y-1">
            {files.map((f) => (
              <div key={f.storage_path} className="text-label-small text-m-on-surface-variant">
                📎 {f.name} ({Math.round(f.size / 1024)}KB)
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- MessageItem
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/MessageItem.tsx src/components/MessageItem.test.tsx
git commit -m "feat(ui): MessageItem component (inbound/outbound/note variants)"
```

---

### Task 7: `AssigneePicker.tsx` component

**Files:**
- Create: `src/components/AssigneePicker.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTeam } from "@/hooks/useTeam";
import { useUpdateBriefAssignee } from "@/hooks/useBriefActions";
import { toast } from "sonner";

interface AssigneePickerProps {
  briefId: string;
  assigneeId: string | null;
}

export function AssigneePicker({ briefId, assigneeId }: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: teamRaw = [] } = useTeam();
  const update = useUpdateBriefAssignee();

  // useTeam returns { data, createMember, ... } — extract member rows
  const team = (teamRaw as unknown as { id: string; full_name: string; email: string }[]).filter(
    (m) => !("archived_at" in m && (m as { archived_at?: string | null }).archived_at),
  );

  const current = team.find((m) => m.id === assigneeId);
  const label = current ? current.full_name : "Unassigned";

  const assign = async (id: string | null) => {
    try {
      await update.mutateAsync({ briefId, assigneeId: id });
      setOpen(false);
    } catch {
      toast.error("Failed to update assignee");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-label-small">
          {label}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1">
        <button
          onClick={() => assign(null)}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-body-medium hover:bg-m-surface-container"
        >
          {!assigneeId && <Check className="h-4 w-4" />}
          {assigneeId && <span className="h-4 w-4" />}
          Unassigned
        </button>
        {team.map((m) => (
          <button
            key={m.id}
            onClick={() => assign(m.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-body-medium hover:bg-m-surface-container"
          >
            {assigneeId === m.id ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
            {m.full_name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Check `useTeam` return shape**

```bash
grep -A 10 "export function useTeam" src/hooks/useTeam.ts
```

If `useTeam()` returns a query object (not `{ data, createMember }`), adjust the destructure in `AssigneePicker` accordingly — replace `const { data: teamRaw = [] } = useTeam();` with whatever the actual hook returns.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/AssigneePicker.tsx
git commit -m "feat(ui): AssigneePicker popover component"
```

---

### Task 8: `BriefList.tsx` component

**Files:**
- Create: `src/components/BriefList.tsx`

- [ ] **Step 1: Create the component**

BriefList renders a flat list of brief rows for a given tab scope. Each row navigates to `/inbox/:briefId` on click.

```tsx
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useBriefs, type BriefScope } from "@/hooks/useBriefs";
import { STATUS_LABEL } from "@/lib/brief-routing";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
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
}

export function BriefList({ scope, currentUserId, selectedBriefId }: BriefListProps) {
  const { data: briefs = [], isLoading } = useBriefs(scope, currentUserId);

  if (isLoading) return <div className="text-body-medium text-m-on-surface-variant p-4">Loading…</div>;
  if (briefs.length === 0) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">{EMPTY[scope]}</div>;
  }

  return (
    <div className="space-y-2">
      {briefs.map((b: Brief) => (
        <Link key={b.id} to={`/inbox/${b.id}`} className="block">
          <Card className={`transition-colors hover:bg-m-surface-container ${selectedBriefId === b.id ? "ring-2 ring-m-primary" : ""}`}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-title-small">
                  {b.raw_subject ?? "(no subject)"}
                </div>
                <div className="text-label-small text-m-on-surface-variant">
                  {b.sender_email ?? "manual"}
                  {b.message_count > 0 && ` · ${b.message_count} msg${b.message_count !== 1 ? "s" : ""}`}
                  {b.last_message_at && ` · ${relativeTime(b.last_message_at)}`}
                </div>
              </div>
              <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/BriefList.tsx
git commit -m "feat(ui): BriefList component with scope-aware empty states"
```

---

### Task 9: `BriefConversation.tsx` component + tests

**Files:**
- Create: `src/components/BriefConversation.tsx`
- Create: `src/components/BriefConversation.test.tsx`

- [ ] **Step 1: Write failing tests first**

```tsx
// src/components/BriefConversation.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

// Mock hooks that require Supabase
vi.mock("@/hooks/useBriefMessages", () => ({
  useBriefMessages: () => ({
    data: [
      {
        id: "msg-1",
        brief_id: "brief-1",
        gmail_message_id: "gm-1",
        direction: "inbound",
        from_email: "client@example.com",
        from_name: "Alice",
        to_emails: [],
        cc_emails: [],
        subject: "Hello",
        body_text: "Message body",
        body_html: null,
        attachments: [],
        sent_at: "2026-05-01T10:00:00Z",
        relayed_by: null,
        created_at: "2026-05-01T10:00:00Z",
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useBriefActions", () => ({
  useAddInternalNote: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useBriefDownstream: () => ({ data: { kind: "none" } }),
  useUpdateBriefAssignee: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/useTeam", () => ({
  useTeam: () => ({ data: [] }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { email: "brendan@convertedclick.co.za" } }),
  useCurrentUserId: () => "user-1",
}));

import { BriefConversation } from "./BriefConversation";

const brief = {
  id: "brief-1",
  raw_subject: "Test brief",
  client_id: null,
  assignee_id: null,
  status: "new",
  sender_email: "client@example.com",
  raw_body: "",
  received_at: "2026-05-01T10:00:00Z",
  gmail_thread_id: null,
  gmail_thread_id_unique: null,
  last_message_at: null,
  message_count: 0,
  source: "gmail_relay",
  triaged_by: null,
  triaged_at: null,
  rejection_reason: null,
  updated_at: null,
  created_at: "2026-05-01T10:00:00Z",
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("BriefConversation", () => {
  it("renders the brief subject in the header", () => {
    render(<BriefConversation brief={brief as never} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("Test brief")).toBeInTheDocument();
  });

  it("renders a message from the timeline", () => {
    render(<BriefConversation brief={brief as never} open onClose={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText("Message body")).toBeInTheDocument();
  });

  it("submits an internal note", async () => {
    const { useAddInternalNote } = await import("@/hooks/useBriefActions");
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    (useAddInternalNote as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false });

    render(<BriefConversation brief={brief as never} open onClose={() => {}} />, { wrapper: Wrapper });

    fireEvent.change(screen.getByPlaceholderText(/add an internal note/i), {
      target: { value: "My note" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ body: "My note" }),
    ));
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -- BriefConversation
```

Expected: FAIL — `BriefConversation` not found.

- [ ] **Step 3: Implement `BriefConversation.tsx`**

```tsx
import { useRef, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AssigneePicker } from "@/components/AssigneePicker";
import { MessageItem } from "@/components/MessageItem";
import { useBriefMessages } from "@/hooks/useBriefMessages";
import { useAddInternalNote, useBriefDownstream } from "@/hooks/useBriefActions";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

interface BriefConversationProps {
  brief: Brief;
  open: boolean;
  onClose: () => void;
}

export function BriefConversation({ brief, open, onClose }: BriefConversationProps) {
  const { user } = useAuth();
  const { data: messages = [], isLoading } = useBriefMessages(brief.id);
  const addNote = useAddInternalNote(brief.id);
  const { data: downstream } = useBriefDownstream(brief.id);
  const [noteText, setNoteText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages load
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Synthesize a message from raw_body for legacy manual briefs with no messages
  const displayMessages = messages.length > 0
    ? messages
    : brief.raw_body
    ? [{
        id: "synthetic",
        brief_id: brief.id,
        gmail_message_id: "synthetic",
        direction: "inbound" as const,
        from_email: brief.sender_email,
        from_name: null,
        to_emails: [],
        cc_emails: [],
        subject: brief.raw_subject,
        body_text: brief.raw_body,
        body_html: null,
        attachments: [],
        sent_at: brief.received_at,
        relayed_by: null,
        created_at: brief.received_at,
      }]
    : [];

  const submitNote = async () => {
    const body = noteText.trim();
    if (!body || !user?.email) return;
    try {
      await addNote.mutateAsync({ body, authorEmail: user.email });
      setNoteText("");
    } catch {
      toast.error("Failed to save note");
    }
  };

  const downstreamChip = downstream && downstream.kind !== "none" ? (
    <Button asChild variant="outline" size="sm" className="h-7 text-label-small">
      <Link to={
        downstream.kind === "project" ? `/projects/${downstream.id}` :
        downstream.kind === "quote" ? `/quotes/${downstream.id}` :
        `/briefs/${brief.id}/scope`
      }>
        {downstream.kind === "project" ? "Project" :
         downstream.kind === "quote" ? "Quote" : "Scope"} →
      </Link>
    </Button>
  ) : null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl p-0">
        <SheetHeader className="flex-shrink-0 border-b p-4">
          <div className="flex items-start justify-between gap-2">
            <SheetTitle className="text-title-medium leading-snug line-clamp-2">
              {brief.raw_subject ?? "(no subject)"}
            </SheetTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {brief.sender_email && (
              <Badge variant="secondary" className="text-label-small">{brief.sender_email}</Badge>
            )}
            <AssigneePicker briefId={brief.id} assigneeId={brief.assignee_id ?? null} />
            {downstreamChip}
          </div>
        </SheetHeader>

        {/* Message timeline */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && <div className="text-body-medium text-m-on-surface-variant">Loading…</div>}
          {!isLoading && displayMessages.map((m) => (
            <MessageItem key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Internal note form */}
        <div className="flex-shrink-0 border-t p-4 space-y-2">
          <Textarea
            placeholder="Add an internal note…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            className="resize-none"
          />
          <Button
            size="sm"
            disabled={!noteText.trim() || addNote.isPending}
            onClick={submitNote}
          >
            Add note
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- BriefConversation
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/BriefConversation.tsx src/components/BriefConversation.test.tsx
git commit -m "feat(ui): BriefConversation sheet with message timeline and note form"
```

---

### Task 10: Rewrite `Inbox.tsx` + add `/inbox/:briefId` route

**Files:**
- Modify: `src/pages/Inbox.tsx` (full rewrite)
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the `/inbox/:briefId` route in `App.tsx`**

In [src/App.tsx](src/App.tsx), find the existing inbox route and add the parameterised sibling:

```tsx
// Find this line:
<Route path="inbox" element={<Inbox />} />

// Replace with:
<Route path="inbox" element={<Inbox />} />
<Route path="inbox/:briefId" element={<Inbox />} />
```

- [ ] **Step 2: Rewrite `Inbox.tsx`**

```tsx
import { useNavigate, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefList } from "@/components/BriefList";
import { BriefConversation } from "@/components/BriefConversation";
import { useBrief } from "@/hooks/useBriefs";
import { useCurrentUserId } from "@/context/AuthContext";
import { Link } from "react-router-dom";
import type { BriefScope } from "@/hooks/useBriefs";

export function Inbox() {
  const { briefId } = useParams<{ briefId?: string }>();
  const currentUserId = useCurrentUserId();
  const navigate = useNavigate();
  const { data: selectedBrief } = useBrief(briefId);

  const defaultTab: BriefScope = currentUserId ? "mine" : "all";

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-headline-medium">Inbox</h1>
        <Button asChild>
          <Link to="/briefs/new">
            <Plus className="h-4 w-4" /> New brief
          </Link>
        </Button>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="mine">Mine</TabsTrigger>
          <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
          <TabsTrigger value="waiting">Waiting</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        {(["mine", "unassigned", "waiting", "all"] as BriefScope[]).map((scope) => (
          <TabsContent key={scope} value={scope}>
            <BriefList
              scope={scope}
              currentUserId={currentUserId}
              selectedBriefId={briefId}
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
  );
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Start the dev server and verify manually**

```bash
npm run dev
```

Open `http://localhost:5174/inbox` in the browser. Confirm:
- 4 tabs render (Mine / Unassigned / Waiting / All)
- Default tab is "Mine" when signed in as a team member
- Clicking a brief row navigates to `/inbox/:briefId` and opens the Sheet
- Sheet header shows subject, sender badge, assignee picker
- Closing Sheet navigates back to `/inbox`
- Legacy manual briefs (no `brief_messages` rows) synthesize one message from `raw_body`

- [ ] **Step 5: Commit**

```bash
git add src/pages/Inbox.tsx src/App.tsx
git commit -m "feat(ui): Inbox v2 — 4-tab layout with BriefConversation sheet"
```

---

### Phase 2 Checkpoint

Before proceeding to Phase 3:
- [ ] Brendan labels 5 real client Gmail threads with `→Inbox/Push`. Verify `briefs` + `brief_messages` rows appear in the Inbox.
- [ ] Assign a brief to yourself. Confirm it appears in "Mine" tab and disappears from "Unassigned".
- [ ] Add an internal note to a brief. Confirm it appears in the timeline.
- [ ] Navigate to a brief with a downstream scope/quote/project. Confirm the chip renders and deep-links correctly.
- [ ] Sign off in writing (comment in this plan or a Slack message) before Phase 3 starts.

---

## Phase 3 — Wiki Context for AI Scoping

### Task 11: Migration — `wiki_path` + `ai_context_snapshot`

**Files:**
- Create: `supabase/migrations/0028_clients_wiki_path.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 0028_clients_wiki_path.sql
-- Phase 3 of Inbox v2: wiki context for AI scoping.

alter table public.clients add column wiki_path text;

-- Seed wiki_path for existing clients using a slug derived from name.
update public.clients
   set wiki_path = 'wiki/clients/' || regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')
 where wiki_path is null;

alter table public.scopes add column ai_context_snapshot text;
```

- [ ] **Step 2: Apply via the cc-supabase MCP**

Use `mcp__cc-supabase__apply_migration` with name `clients_wiki_path` and the SQL above.

- [ ] **Step 3: Regenerate TypeScript types**

```bash
npx supabase gen types typescript \
  --project-id lpgwxacoqiqpcfpkklib \
  --schema public > src/types/db.ts
```

Expected: `clients` Row now has `wiki_path: string | null`, `scopes` Row now has `ai_context_snapshot: string | null`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0028_clients_wiki_path.sql src/types/db.ts
git commit -m "feat(db): add wiki_path to clients, ai_context_snapshot to scopes"
```

---

### Task 12: `loadClientWikiContext` shared helper

**Files:**
- Create: `supabase/functions/_shared/wiki-context.ts`

This file runs in Deno, not Node. Use standard `fetch`, not node packages.

- [ ] **Step 1: Create the helper**

```ts
// supabase/functions/_shared/wiki-context.ts
//
// Fetches all non-hidden markdown files from a client's wiki folder on GitHub
// and assembles them into a <client_context> XML block for AI prompts.
//
// - Returns an empty string if the folder does not exist (404) — never throws.
// - Skips files whose frontmatter has `context: hidden` (case-insensitive).

interface WikiFile {
  name: string;
  path: string;
  download_url: string;
  type: "file" | "dir";
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const k = line.slice(0, sep).trim();
    const v = line.slice(sep + 1).trim();
    fm[k] = v;
  }
  return fm;
}

async function listDir(repo: string, path: string, pat: string): Promise<WikiFile[]> {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=main`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchRaw(downloadUrl: string, pat: string): Promise<string> {
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!res.ok) throw new Error(`Raw fetch failed: ${res.status}`);
  return res.text();
}

export async function loadClientWikiContext(opts: {
  clientName: string;
  wikiPath: string; // e.g. "wiki/clients/Kings-College"
  repo: string;    // e.g. "convertedclick/cc-vault"
  pat: string;
}): Promise<string> {
  const { clientName, wikiPath, repo, pat } = opts;

  let files: WikiFile[];
  try {
    files = await listDir(repo, wikiPath, pat);
  } catch (err) {
    console.warn(`[wiki-context] listDir failed: ${err}`);
    return "";
  }
  if (files.length === 0) return "";

  const mdFiles = files.filter((f) => f.type === "file" && f.name.endsWith(".md"));
  if (mdFiles.length === 0) return "";

  const noteParts: string[] = [];
  for (const file of mdFiles) {
    let content: string;
    try {
      content = await fetchRaw(file.download_url, pat);
    } catch (err) {
      console.warn(`[wiki-context] fetch failed for ${file.path}: ${err}`);
      continue;
    }

    const fm = parseFrontmatter(content);
    // Skip context: hidden (accept string "true" or boolean true)
    if (String(fm["context"]).toLowerCase() === "hidden" || fm["context"] === true) {
      continue;
    }

    // Strip frontmatter from content before injecting
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    noteParts.push(`  <note path="${file.name}">${body}</note>`);
  }

  if (noteParts.length === 0) return "";

  return [
    `<client_context client_name="${clientName}" wiki_path="${wikiPath}">`,
    ...noteParts,
    `</client_context>`,
  ].join("\n");
}
```

- [ ] **Step 2: Write Deno unit tests**

Create `supabase/functions/_shared/wiki-context.test.ts`:

```ts
// Run with: deno test supabase/functions/_shared/wiki-context.test.ts
import { assertEquals } from "jsr:@std/assert";
import { loadClientWikiContext } from "./wiki-context.ts";

// Mock fetch globally
const makeResponse = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

Deno.test("returns empty string when folder does not exist (404)", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(makeResponse({}, 404));
  const result = await loadClientWikiContext({
    clientName: "Acme",
    wikiPath: "wiki/clients/Acme",
    repo: "org/vault",
    pat: "token",
  });
  assertEquals(result, "");
  globalThis.fetch = origFetch;
});

Deno.test("skips files with context: hidden frontmatter", async () => {
  const files = [{ name: "index.md", path: "wiki/clients/Acme/index.md", download_url: "http://raw/index.md", type: "file" }];
  const hiddenContent = "---\ncontext: hidden\n---\n# Secret";
  const origFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = () => {
    call++;
    if (call === 1) return Promise.resolve(makeResponse(files));
    return Promise.resolve(makeResponse(hiddenContent, 200));
  };
  const result = await loadClientWikiContext({
    clientName: "Acme",
    wikiPath: "wiki/clients/Acme",
    repo: "org/vault",
    pat: "token",
  });
  assertEquals(result, "");
  globalThis.fetch = origFetch;
});

Deno.test("assembles XML block from non-hidden files", async () => {
  const files = [{ name: "brand.md", path: "wiki/clients/Acme/brand.md", download_url: "http://raw/brand.md", type: "file" }];
  const content = "# Brand\nVoice: friendly";
  const origFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = () => {
    call++;
    if (call === 1) return Promise.resolve(makeResponse(files));
    return Promise.resolve(makeResponse(content, 200));
  };
  const result = await loadClientWikiContext({
    clientName: "Acme",
    wikiPath: "wiki/clients/Acme",
    repo: "org/vault",
    pat: "token",
  });
  assertEquals(result.includes('<client_context client_name="Acme"'), true);
  assertEquals(result.includes("Voice: friendly"), true);
  globalThis.fetch = origFetch;
});
```

- [ ] **Step 3: Run Deno tests**

```bash
deno test supabase/functions/_shared/wiki-context.test.ts
```

Expected: 3 passing.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/wiki-context.ts supabase/functions/_shared/wiki-context.test.ts
git commit -m "feat(edge): loadClientWikiContext shared helper with Deno tests"
```

---

### Task 13: Modify `draft-scope` to inject wiki context

**Files:**
- Modify: `supabase/functions/draft-scope/index.ts`

- [ ] **Step 1: Read the current file**

Open [supabase/functions/draft-scope/index.ts](supabase/functions/draft-scope/index.ts) and confirm the current structure (brief fetch, Anthropic call, upsert).

- [ ] **Step 2: Add wiki context loading**

Replace the full contents of `supabase/functions/draft-scope/index.ts`:

```ts
// supabase/functions/draft-scope/index.ts
//
// Request:  POST { brief_id: string; nudge?: string }
// Response: 200 { scope: { enhanced_prose, in_scope_md, out_of_scope_md, open_questions_md } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";
import { loadClientWikiContext } from "../_shared/wiki-context.ts";

const WIKI_REPO = Deno.env.get("WIKI_GITHUB_REPO") ?? "";
const WIKI_PAT  = Deno.env.get("WIKI_GITHUB_PAT")  ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { brief_id, nudge } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createUserClient(req);

    const [{ data: settings }, { data: brief, error: bErr }] = await Promise.all([
      supabase.from("settings").select("anthropic_model").eq("id", 1).single(),
      supabase
        .from("briefs")
        .select("*, client:clients(id, name, wiki_path)")
        .eq("id", brief_id)
        .single(),
    ]);
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";
    const client = (brief as { client?: { id: string; name: string; wiki_path: string | null } | null }).client;

    // Best-effort: load wiki context. Never fails the brief if unavailable.
    let wikiContext = "";
    if (client?.wiki_path && WIKI_REPO && WIKI_PAT) {
      try {
        wikiContext = await loadClientWikiContext({
          clientName: client.name,
          wikiPath: client.wiki_path,
          repo: WIKI_REPO,
          pat: WIKI_PAT,
        });
      } catch (err) {
        console.warn(`[draft-scope] wiki context failed: ${err}`);
      }
    }

    const system = [
      "You are a digital agency scoping analyst at Converted Click.",
      "A client sent a request. Rewrite it as:",
      "1) enhanced_prose — one-paragraph clarified summary",
      "2) in_scope — bullet list of explicit in-scope items",
      "3) out_of_scope — bullet list of likely out-of-scope items to confirm exclusion",
      "4) open_questions — bullet list of questions to ask before quoting",
      'Return JSON only: {"enhanced_prose":"","in_scope":[],"out_of_scope":[],"open_questions":[]}.',
      "Do not invent services or commitments.",
    ].join("\n");

    const clientName = client?.name;
    const userParts = [
      clientName ? `Client: ${clientName}` : null,
      `Subject: ${brief.raw_subject ?? "(none)"}`,
      "",
      "Body:",
      brief.raw_body,
      nudge ? `\n\nAdditional guidance from staff: ${nudge}` : null,
      wikiContext ? `\n\n${wikiContext}` : null,
    ].filter(Boolean).join("\n");

    const body = await callAnthropic({
      model,
      system,
      messages: [{ role: "user", content: userParts }],
      maxTokens: 2048,
      cacheSystem: true,
    });

    const text: string = body.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "AI did not return JSON", raw: text }, 502);

    const parsed = JSON.parse(match[0]);
    const scope = {
      enhanced_prose: String(parsed.enhanced_prose ?? ""),
      in_scope_md: (parsed.in_scope ?? []).map((s: string) => `- ${s}`).join("\n"),
      out_of_scope_md: (parsed.out_of_scope ?? []).map((s: string) => `- ${s}`).join("\n"),
      open_questions_md: (parsed.open_questions ?? []).map((s: string) => `- ${s}`).join("\n"),
    };

    await supabase
      .from("scopes")
      .upsert(
        {
          brief_id,
          ...scope,
          ai_drafted: true,
          ai_context_snapshot: wikiContext || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "brief_id" },
      );

    return json({ scope });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("Anthropic ")) return json({ error: msg }, 502);
    return json({ error: msg }, 500);
  }
});
```

- [ ] **Step 3: Deploy the updated edge function**

Use `mcp__cc-supabase__deploy_edge_function` with function name `draft-scope`.

- [ ] **Step 4: Store the required secrets**

These must be set before the function will use wiki context. Complete steps in the spec's "Open items requiring Brendan's hand" section:

1. Push CC-Vault to `convertedclick/cc-vault` private GitHub repo.
2. Generate a fine-grained PAT (Contents: Read+Write) for that repo.
3. Set secrets via Supabase dashboard (Project Settings → Edge Functions → Secrets):
   - `WIKI_GITHUB_PAT` = the PAT
   - `WIKI_GITHUB_REPO` = `convertedclick/cc-vault`

- [ ] **Step 5: Commit the function file**

```bash
git add supabase/functions/draft-scope/index.ts
git commit -m "feat(edge): draft-scope injects client wiki context from GitHub"
```

---

### Task 14: `provision-client-wiki` Edge Function

**Files:**
- Create: `supabase/functions/provision-client-wiki/index.ts`

- [ ] **Step 1: Create the edge function**

```ts
// supabase/functions/provision-client-wiki/index.ts
//
// Request:  POST { client_name: string; wiki_path: string }
// Response: 200 { created: boolean }
//         409 already exists → 200 { created: false }
//         5xx → log, return 500
//
// Fire-and-forget — caller does NOT await this for client creation flow.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

const WIKI_REPO = Deno.env.get("WIKI_GITHUB_REPO") ?? "";
const WIKI_PAT  = Deno.env.get("WIKI_GITHUB_PAT")  ?? "";

function starterTemplate(name: string): string {
  return [
    "---",
    `type: client`,
    `title: "${name}"`,
    `created: ${new Date().toISOString().slice(0, 10)}`,
    `status: active`,
    `tags: [client]`,
    "---",
    "",
    `# ${name}`,
    "",
    "## About",
    "",
    "## Brand",
    "",
    "## Decisions",
    "",
  ].join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!WIKI_REPO || !WIKI_PAT) return json({ error: "WIKI secrets not configured" }, 503);

  try {
    // Verify caller is signed in (user JWT required)
    const supabase = createUserClient(req);
    const { error: authErr } = await supabase.auth.getUser();
    if (authErr) return json({ error: "Unauthorized" }, 401);

    const { client_name, wiki_path } = await req.json();
    if (!client_name || !wiki_path) return json({ error: "client_name and wiki_path required" }, 400);

    const filePath = `${wiki_path}/index.md`;
    const content = starterTemplate(client_name);
    const encoded = btoa(unescape(encodeURIComponent(content))); // base64

    const res = await fetch(
      `https://api.github.com/repos/${WIKI_REPO}/contents/${encodeURIComponent(filePath)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${WIKI_PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `chore: provision wiki for ${client_name}`,
          content: encoded,
        }),
      },
    );

    if (res.status === 422 || res.status === 409) {
      // File already exists — silent no-op
      return json({ created: false });
    }
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[provision-client-wiki] GitHub ${res.status}: ${errBody}`);
      return json({ error: "GitHub API error" }, 500);
    }

    return json({ created: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[provision-client-wiki] ${msg}`);
    return json({ error: msg }, 500);
  }
});
```

- [ ] **Step 2: Deploy the edge function**

Use `mcp__cc-supabase__deploy_edge_function` with function name `provision-client-wiki`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/provision-client-wiki/index.ts
git commit -m "feat(edge): provision-client-wiki — auto-creates GitHub wiki folder"
```

---

### Task 15: Wire auto-provision + add `wiki_path` edit to Clients page

**Files:**
- Modify: `src/hooks/useClients.ts`
- Modify: `src/pages/Clients.tsx`

- [ ] **Step 1: Read the current `useCreateClient` in `useClients.ts`**

Open [src/hooks/useClients.ts](src/hooks/useClients.ts) and find `useCreateClient`.

- [ ] **Step 2: Add fire-and-forget provision call to `useCreateClient`**

After the successful client row insert, add a fire-and-forget call (do NOT `await` it, do NOT let it block or throw):

```ts
// Inside useCreateClient's mutationFn, after "return data":
// (example — adapt to the actual function structure)

const { data, error } = await supabase.from("clients").insert(input).select().single();
if (error) throw error;

// Fire-and-forget wiki provisioning
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const { data: sessionData } = await supabase.auth.getSession();
const accessToken = sessionData.session?.access_token ?? "";
fetch(`${supabaseUrl}/functions/v1/provision-client-wiki`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    client_name: data.name,
    wiki_path: `wiki/clients/${data.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`,
  }),
}).catch((err) => console.warn("[provision-client-wiki] fire-and-forget failed:", err));

return data;
```

- [ ] **Step 3: Read `src/pages/Clients.tsx` to understand the current edit pattern**

Open [src/pages/Clients.tsx](src/pages/Clients.tsx). Find where client fields are displayed/edited.

- [ ] **Step 4: Add `wiki_path` as an editable field**

In the client edit form or inline-edit row, add a `wiki_path` text input. Use the existing `useUpdateClient` (or equivalent mutation) to PATCH the field. Example pattern — adapt to whatever edit UI already exists:

```tsx
// Inside the client edit section, alongside other editable fields:
<div className="space-y-1">
  <label className="text-label-small text-m-on-surface-variant">Wiki path</label>
  <Input
    value={editWikiPath}
    onChange={(e) => setEditWikiPath(e.target.value)}
    placeholder="wiki/clients/client-slug"
    className="font-mono text-body-small"
  />
</div>
```

Wire `editWikiPath` state to `useUpdateClient` (or `useUpdateBrief`-style mutation on the `clients` table) on save/blur.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Manual verification**

1. Create a new client in the app. Check the GitHub repo for `wiki/clients/<slug>/index.md`.
2. Edit a client's `wiki_path` in the Clients page. Confirm it saves.
3. Run scope-draft on a brief for that client. Open the Supabase `scopes` table and confirm `ai_context_snapshot` contains the wiki content.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useClients.ts src/pages/Clients.tsx
git commit -m "feat: wire provision-client-wiki on create + wiki_path edit in Clients page"
```

---

### Phase 3 Checkpoint

Before closing the spec:
- [ ] Brendan runs scope-draft on 3 real new briefs for clients with populated wiki folders.
- [ ] Verify the AI output meaningfully references wiki content (brand voice, past decisions, known context).
- [ ] Check `scopes.ai_context_snapshot` in Supabase for each brief to confirm the context was fetched.
- [ ] Confirm that a brief for a client with no wiki folder still produces a scope draft (graceful empty context).
- [ ] Sign off — spec complete.

---

## Self-Review

### Spec coverage check

| Spec requirement | Task covering it |
|---|---|
| `brief_messages` table | Task 1 (already in migration 0023, already applied) |
| `relay_secrets` + gmail-relay + Apps Script | Phase 1 ✅ already shipped |
| `assignee_id` on briefs | Task 1 |
| DOMPurify HTML sanitisation | Task 2 + Task 6 |
| `useBriefMessages` with Realtime | Task 4 |
| `useUpdateBriefAssignee` | Task 5 |
| `useAddInternalNote` | Task 5 |
| `useBriefDownstream` | Task 5 |
| `BriefList.tsx` | Task 8 |
| `MessageItem.tsx` (3 variants) | Task 6 |
| `AssigneePicker.tsx` | Task 7 |
| `BriefConversation.tsx` | Task 9 |
| Inbox.tsx rewrite (4 tabs) | Task 10 |
| `/inbox/:briefId` route | Task 10 |
| Legacy brief synthetic message | Task 9 (`displayMessages` fallback) |
| `wiki_path` on clients | Task 11 |
| `ai_context_snapshot` on scopes | Task 11 |
| `loadClientWikiContext` helper | Task 12 |
| `context: hidden` frontmatter filter | Task 12 |
| `draft-scope` wiki injection | Task 13 |
| `provision-client-wiki` Edge Function | Task 14 |
| Fire-and-forget on client create | Task 15 |
| `wiki_path` edit in Clients page | Task 15 |
| Phase 2 checkpoint (real-world sign-off) | Phase 2 Checkpoint section |
| Phase 3 checkpoint | Phase 3 Checkpoint section |

All spec requirements are covered. ✓

### Type consistency check

- `BriefScope` exported from `useBriefs.ts` and imported in `BriefList.tsx` and `Inbox.tsx` ✓
- `BriefMessage` exported from `useBriefMessages.ts` and used by `MessageItem.tsx` and `BriefConversation.tsx` ✓
- `DownstreamLink` exported from `useBriefActions.ts` and consumed in `BriefConversation.tsx` ✓
- `Brief` type is `Database["public"]["Tables"]["briefs"]["Row"]` throughout ✓

### Placeholder check

No TBD, TODO, or "similar to Task N" references. All code blocks are complete. ✓
