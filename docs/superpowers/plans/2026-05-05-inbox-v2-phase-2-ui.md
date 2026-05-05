# Inbox v2 — Phase 2: UI rewrite — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Phase 1 (`2026-05-05-inbox-v2-phase-1-intake-threading.md`) shipped and signed off. `briefs.last_message_at`, `briefs.message_count`, and `brief_messages` table must already exist.

**Goal:** Replace the bucketed-list Inbox with a tab + conversation-pane UI: four default tabs (Mine / Unassigned / Waiting / All), one row per brief, click → opens a side pane with the full message timeline, assignee picker, internal-note composer, and downstream-link chips.

**Architecture:** Single-page `Inbox.tsx` route with a master-detail layout — list on the left, conversation pane on the right (drawer on mobile). The conversation pane reads `brief_messages` via TanStack Query + a Supabase Realtime subscription so a relay arriving mid-triage updates the open pane live. Internal notes are persisted as `brief_messages` rows with `direction='note'` and a synthetic `gmail_message_id = note-<uuid>`. Triage actions (Accept / Needs info / Spam) move from the inline-expander pattern into the conversation pane.

**Tech Stack:** React 18 + TypeScript, TanStack Query 5, `@radix-ui/react-tabs` (already installed), `@radix-ui/react-popover` (assignee picker), `@radix-ui/react-dialog` (mobile drawer), shadcn/ui, sonner toasts, **`dompurify` + `@types/dompurify` (new dep)**.

**Spec reference:** [docs/superpowers/specs/2026-05-05-inbox-v2-and-wiki-context-design.md](../specs/2026-05-05-inbox-v2-and-wiki-context-design.md) — Phase 2.

**Plan-level decisions (made by Brendan's expertise approval, departing from spec):**
- **No virtualised list in v1.** The codebase has no virtualisation library and current brief volume is < 100. Plain `.map()` is fine; add `react-virtuoso` only when count crosses ~500. The spec's "virtualised" phrasing is a forward-looking note.
- **Triage actions live in the conversation pane**, not in the row. Rows are pure list items (subject, sender, assignee, message count, downstream chip, time). Clicking opens the pane; the pane has Accept / Needs info / Spam / assign-client controls. This is a breaking change from current `BriefRow` — see Task 5.

**Project-wide gotchas:**
- `currentUserId` from `useCurrentUserId()` returns `null` for the shared `team@convertedclick.co.za` login — Mine tab defaults to All in that case.
- Realtime subscriptions: `supabase.channel(...)` is not used elsewhere in this repo. The pattern is documented inline in Task 4. Required Postgres replication: `brief_messages` must be added to `supabase_realtime` publication (Task 1).
- `Database` types live in `src/types/db.ts` — regenerate via MCP after the migration.
- `briefs.assignee_id` references `team_members(id)` `on delete set null` — UI must render "Unassigned" when null.

---

## File Structure

**Migration**
- Create: `supabase/migrations/0024_brief_assignee_and_realtime.sql`

**Types**
- Regenerate: `src/types/db.ts`

**Dependencies**
- Add: `dompurify@^3.2.4`, `@types/dompurify@^3.0.5` (devDep)

**Hooks**
- Modify: `src/hooks/useBriefs.ts` — add scope-filtered selector; add `useUpdateBriefAssignee`
- Create: `src/hooks/useBriefMessages.ts`
- Create: `src/hooks/useBriefDownstream.ts`

**Components**
- Create: `src/components/inbox/BriefList.tsx`
- Create: `src/components/inbox/BriefRowV2.tsx` (replaces `src/components/BriefRow.tsx` once Phase 2 ships)
- Create: `src/components/inbox/BriefConversation.tsx`
- Create: `src/components/inbox/MessageItem.tsx`
- Create: `src/components/inbox/AssigneePicker.tsx`
- Create: `src/components/inbox/InternalNoteComposer.tsx`
- Create: `src/components/inbox/TriageActions.tsx`
- Create: `src/lib/sanitize-html.ts`
- Create: `src/lib/sanitize-html.test.ts`
- Create: `src/lib/relative-time.ts`
- Create: `src/lib/relative-time.test.ts`

**Pages / routing**
- Modify: `src/pages/Inbox.tsx` — full rewrite (the existing 135-line file is replaced; legacy `BriefRow.tsx` stays in tree until no other importers, then deleted)
- Modify: `src/App.tsx` — add `/inbox/:briefId` route alias to the same `Inbox` component

---

## Task 1: Migration — `0024_brief_assignee_and_realtime.sql`

**Files:**
- Create: `supabase/migrations/0024_brief_assignee_and_realtime.sql`
- Regenerate: `src/types/db.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0024_brief_assignee_and_realtime.sql`:

```sql
-- 0024_brief_assignee_and_realtime.sql
-- Apply via mcp__cc-supabase__apply_migration (name: brief_assignee_and_realtime)
-- Phase 2 of Inbox v2: per-brief assignee + enable Realtime on brief_messages.

-- 1. Per-brief assignee (nullable; on team_member delete → set null).
alter table public.briefs
  add column assignee_id uuid references public.team_members(id) on delete set null;
create index briefs_assignee_idx on public.briefs (assignee_id) where assignee_id is not null;

-- 2. Add brief_messages to the Realtime publication so the conversation pane
--    receives live INSERTs for the open brief. supabase_realtime is the
--    publication Realtime listens on by default.
alter publication supabase_realtime add table public.brief_messages;

comment on column public.briefs.assignee_id is
  'Team member responsible for the next action on this brief. Used to drive the Mine/Unassigned tabs.';
```

- [ ] **Step 2: Apply the migration**

Run:
```
mcp__cc-supabase__apply_migration(
  name: "brief_assignee_and_realtime",
  query: <contents of the file>
)
```

Expected: success.

- [ ] **Step 3: Verify**

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='briefs' and column_name='assignee_id'; select pubname, schemaname, tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='brief_messages';"
)
```

Expected: `assignee_id` row + 1 row showing `brief_messages` is in `supabase_realtime`.

- [ ] **Step 4: Regenerate types**

Run `mcp__cc-supabase__generate_typescript_types()`, write to `src/types/db.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_brief_assignee_and_realtime.sql src/types/db.ts
git commit -m "feat(db): briefs.assignee_id + Realtime on brief_messages"
```

---

## Task 2: Add `dompurify` + sanitisation helper

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/lib/sanitize-html.ts`
- Create: `src/lib/sanitize-html.test.ts`

- [ ] **Step 1: Install dependency**

Run: `npm install dompurify@^3.2.4` and `npm install -D @types/dompurify@^3.0.5`.

- [ ] **Step 2: Write the failing test**

Create `src/lib/sanitize-html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "./sanitize-html";

describe("sanitizeEmailHtml", () => {
  it("strips <script> tags", () => {
    const out = sanitizeEmailHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).toBe("<p>hi</p>");
  });

  it("strips on* event handlers", () => {
    const out = sanitizeEmailHtml('<a href="https://x" onclick="alert(1)">x</a>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("https://x");
  });

  it('strips javascript: URLs from links', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript");
  });

  it("preserves the documented allow-list of tags", () => {
    const html = '<p>p</p><strong>s</strong><em>e</em><ul><li>li</li></ul><blockquote>bq</blockquote><table><tr><td>t</td></tr></table><img src="https://example.com/x.png" />';
    const out = sanitizeEmailHtml(html);
    for (const t of ["<p", "<strong", "<em", "<ul", "<li", "<blockquote", "<table", "<tr", "<td", "<img"]) {
      expect(out).toContain(t);
    }
  });

  it("strips disallowed tags like <iframe>", () => {
    const out = sanitizeEmailHtml('<iframe src="https://evil"></iframe><p>ok</p>');
    expect(out).not.toContain("iframe");
    expect(out).toContain("ok");
  });
});
```

- [ ] **Step 3: Run the test — expect failure**

Run: `npm test -- sanitize-html`

Expected: error "Cannot find module './sanitize-html'".

- [ ] **Step 4: Write the helper**

Create `src/lib/sanitize-html.ts`:

```ts
import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "a", "p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "blockquote",
  "pre", "code", "img", "table", "thead", "tbody", "tr", "td", "th", "div", "span",
  "h1", "h2", "h3", "h4", "h5", "h6",
];

const ALLOWED_ATTR = ["href", "src", "alt", "title", "target", "rel"];

/** Sanitise email HTML to a safe subset. Strips scripts, on* handlers, and
 *  javascript: URLs. Returns a string ready for `dangerouslySetInnerHTML`. */
export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["style"], // strip inline styles to keep app shell unaffected
  });
}
```

- [ ] **Step 5: Run the test — expect pass**

Run: `npm test -- sanitize-html` → 5 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/sanitize-html.ts src/lib/sanitize-html.test.ts
git commit -m "feat(inbox): sanitiseEmailHtml helper + tests"
```

---

## Task 3: Relative-time helper

**Files:**
- Create: `src/lib/relative-time.ts`
- Create: `src/lib/relative-time.test.ts`

Brief rows show `last_message_at` as relative time ("2h ago", "yesterday"). Used in `BriefRowV2.tsx` and `MessageItem.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/relative-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = new Date("2026-05-05T12:00:00Z").getTime();

describe("relativeTime", () => {
  it('returns "just now" within 60 seconds', () => {
    expect(relativeTime(new Date(NOW - 30_000), NOW)).toBe("just now");
  });
  it("returns minutes for < 1 hour", () => {
    expect(relativeTime(new Date(NOW - 5 * 60_000), NOW)).toBe("5m ago");
  });
  it("returns hours for < 24 hours", () => {
    expect(relativeTime(new Date(NOW - 3 * 3600_000), NOW)).toBe("3h ago");
  });
  it("returns days for < 7 days", () => {
    expect(relativeTime(new Date(NOW - 2 * 86400_000), NOW)).toBe("2d ago");
  });
  it("returns a calendar date for >= 7 days", () => {
    expect(relativeTime(new Date(NOW - 30 * 86400_000), NOW)).toMatch(/2026/);
  });
  it("handles ISO strings", () => {
    expect(relativeTime("2026-05-05T11:55:00Z", NOW)).toBe("5m ago");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm test -- relative-time` → "Cannot find module".

- [ ] **Step 3: Write the helper**

Create `src/lib/relative-time.ts`:

```ts
/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago", or full
 *  date for >= 7 days. The optional `now` arg makes it deterministic in tests.
 */
export function relativeTime(input: Date | string, now: number = Date.now()): string {
  const t = typeof input === "string" ? new Date(input).getTime() : input.getTime();
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}
```

- [ ] **Step 4: Run — expect 6/6 pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/relative-time.ts src/lib/relative-time.test.ts
git commit -m "feat(inbox): relativeTime helper + tests"
```

---

## Task 4: `useBriefMessages` hook with Realtime

**Files:**
- Create: `src/hooks/useBriefMessages.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useBriefMessages.ts`:

```ts
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type BriefMessage = Database["public"]["Tables"]["brief_messages"]["Row"];
type BriefMessageInsert = Database["public"]["Tables"]["brief_messages"]["Insert"];

const KEY = (briefId: string) => ["brief-messages", briefId] as const;

/** Lists brief_messages for a brief, ordered chronologically. Subscribes to
 *  Postgres changes via Realtime so the open conversation pane stays live as
 *  Apps Script relays new messages. Falls back to a 30s refetchInterval. */
export function useBriefMessages(briefId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    enabled: !!briefId,
    queryKey: briefId ? KEY(briefId) : ["brief-messages", "none"],
    refetchInterval: 30_000,
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
  });

  useEffect(() => {
    if (!briefId) return;
    const channel = supabase
      .channel(`brief-messages:${briefId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "brief_messages",
          filter: `brief_id=eq.${briefId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: KEY(briefId) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [briefId, qc]);

  return query;
}

/** Insert an internal note. Synthetic gmail_message_id with note- prefix. */
export function useAddInternalNote(briefId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body_text: string; author_email: string }) => {
      if (!briefId) throw new Error("briefId required");
      const row: BriefMessageInsert = {
        brief_id: briefId,
        gmail_message_id: `note-${crypto.randomUUID()}`,
        direction: "note",
        from_email: input.author_email,
        from_name: null,
        to_emails: [],
        cc_emails: [],
        subject: null,
        body_text: input.body_text,
        body_html: null,
        attachments: [],
        sent_at: new Date().toISOString(),
        relayed_by: null,
      };
      const { data, error } = await supabase.from("brief_messages").insert(row).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      if (briefId) qc.invalidateQueries({ queryKey: KEY(briefId) });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useBriefMessages.ts
git commit -m "feat(hooks): useBriefMessages with Realtime + useAddInternalNote"
```

---

## Task 5: Extend `useBriefs` — scope filter + assignee mutation

**Files:**
- Modify: `src/hooks/useBriefs.ts`

- [ ] **Step 1: Add the scope-filtered hook + assignee mutation**

Append to `src/hooks/useBriefs.ts`:

```ts
type BriefScope = "mine" | "unassigned" | "waiting" | "all";

/** Inbox v2 tab-filtered brief list. Sorted by last_message_at desc (nulls
 *  last), received_at desc tiebreak. Pass currentUserId for the 'mine' scope. */
export function useBriefsByScope(scope: BriefScope, currentUserId: string | null) {
  return useQuery({
    queryKey: ["briefs", "scope", scope, currentUserId ?? "anon"],
    queryFn: async (): Promise<Brief[]> => {
      let q = supabase
        .from("briefs")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("received_at", { ascending: false });

      if (scope === "mine") {
        if (!currentUserId) return []; // signed-in shared login → no Mine results
        q = q.eq("assignee_id", currentUserId);
      } else if (scope === "unassigned") {
        q = q.is("assignee_id", null);
      } else if (scope === "waiting") {
        q = q.eq("status", "needs_info");
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateBriefAssignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, assigneeId }: { id: string; assigneeId: string | null }) => {
      const { data, error } = await supabase
        .from("briefs")
        .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: DETAIL(vars.id) });
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck` → expect no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBriefs.ts
git commit -m "feat(hooks): useBriefsByScope + useUpdateBriefAssignee"
```

---

## Task 6: `useBriefDownstream` hook

**Files:**
- Create: `src/hooks/useBriefDownstream.ts`

Returns the strongest existing downstream link for a brief: `project` if linked through quote, else `quote` if scope→quote exists, else `scope` if scope row exists, else `none`. The chain is: brief → scope (1:1 via `scopes.brief_id`) → quote (one live per scope, `quotes.scope_id`) → project (1:1 via `projects.quote_id`).

- [ ] **Step 1: Write the hook**

Create `src/hooks/useBriefDownstream.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type BriefDownstream =
  | { kind: "none" }
  | { kind: "scope"; id: string; label: string; href: string }
  | { kind: "quote"; id: string; label: string; href: string }
  | { kind: "project"; id: string; label: string; href: string };

export function useBriefDownstream(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: ["brief-downstream", briefId],
    queryFn: async (): Promise<BriefDownstream> => {
      if (!briefId) return { kind: "none" };

      const { data: scope } = await supabase
        .from("scopes")
        .select("id")
        .eq("brief_id", briefId)
        .maybeSingle();
      if (!scope) return { kind: "none" };

      const { data: quote } = await supabase
        .from("quotes")
        .select("id, version, status")
        .eq("scope_id", scope.id)
        .neq("status", "superseded")
        .maybeSingle();
      if (!quote) {
        return {
          kind: "scope",
          id: scope.id,
          label: "Scope",
          href: `/briefs/${briefId}/scope`,
        };
      }

      const { data: project } = await supabase
        .from("projects")
        .select("id, name")
        .eq("quote_id", quote.id)
        .maybeSingle();
      if (project) {
        return {
          kind: "project",
          id: project.id,
          label: `Project: ${project.name ?? project.id.slice(0, 6)}`,
          href: `/projects/${project.id}`,
        };
      }

      return {
        kind: "quote",
        id: quote.id,
        label: `Quote v${quote.version ?? ""}`.trim(),
        href: `/quotes/${quote.id}`,
      };
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

`npm run typecheck` → expect no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBriefDownstream.ts
git commit -m "feat(hooks): useBriefDownstream surfaces scope/quote/project chip"
```

---

## Task 7: `MessageItem` component

**Files:**
- Create: `src/components/inbox/MessageItem.tsx`

Three variants based on `direction`: inbound (left, neutral), outbound (right, accent), note (full-width yellow card). Renders sanitised HTML when `body_html` is present, falls back to `body_text` in `<pre>`.

- [ ] **Step 1: Write the component**

Create `src/components/inbox/MessageItem.tsx`:

```tsx
import { Paperclip, StickyNote } from "lucide-react";
import { sanitizeEmailHtml } from "@/lib/sanitize-html";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type BriefMessage = Database["public"]["Tables"]["brief_messages"]["Row"];

type Attachment = { name: string; storage_path: string; mime: string; size: number };

function attachmentsOf(m: BriefMessage): Attachment[] {
  const raw = m.attachments;
  return Array.isArray(raw) ? (raw as Attachment[]) : [];
}

export function MessageItem({ message }: { message: BriefMessage }) {
  if (message.direction === "note") return <NoteItem message={message} />;
  return <EmailItem message={message} variant={message.direction} />;
}

function EmailItem({ message, variant }: { message: BriefMessage; variant: "inbound" | "outbound" }) {
  const isOutbound = variant === "outbound";
  const sender =
    [message.from_name, message.from_email].filter(Boolean).join(" ") || "Unknown";
  const html = (message.body_html ?? "").trim();

  return (
    <div className={cn("flex", isOutbound && "justify-end")}>
      <article
        className={cn(
          "max-w-[85%] rounded-md p-3 shadow-elev-1",
          isOutbound ? "bg-m-primary-container" : "bg-m-surface-container",
        )}
      >
        <header className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-label-large">{isOutbound ? `You · ${sender}` : sender}</span>
          <span className="text-label-small text-m-on-surface-variant">
            {relativeTime(message.sent_at)}
          </span>
        </header>
        {html ? (
          <div
            className="email-body text-body-medium"
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(html) }}
          />
        ) : (
          <pre className="whitespace-pre-wrap text-body-medium">{message.body_text}</pre>
        )}
        <AttachmentList items={attachmentsOf(message)} />
      </article>
    </div>
  );
}

function NoteItem({ message }: { message: BriefMessage }) {
  return (
    <article className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
      <header className="mb-1 flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1 text-label-large">
          <StickyNote className="h-3 w-3" />
          Internal note · {message.from_email ?? "Unknown"}
        </span>
        <span className="text-label-small text-m-on-surface-variant">
          {relativeTime(message.sent_at)}
        </span>
      </header>
      <pre className="whitespace-pre-wrap text-body-medium">{message.body_text}</pre>
    </article>
  );
}

function AttachmentList({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-1">
      {items.map((a, i) => (
        <li key={i} className="flex items-center gap-2 text-label-small text-m-on-surface-variant">
          <Paperclip className="h-3 w-3" />
          {a.name} ({Math.round(a.size / 1024)} KB)
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Run typecheck**

`npm run typecheck` → expect clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/inbox/MessageItem.tsx
git commit -m "feat(inbox): MessageItem with inbound/outbound/note variants"
```

---

## Task 8: `AssigneePicker` component

**Files:**
- Create: `src/components/inbox/AssigneePicker.tsx`

- [ ] **Step 1: Write the picker**

Create `src/components/inbox/AssigneePicker.tsx`:

```tsx
import { useState } from "react";
import { ChevronsUpDown, User, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useTeam } from "@/hooks/useTeam";
import { useUpdateBriefAssignee } from "@/hooks/useBriefs";
import { toast } from "sonner";

export function AssigneePicker({
  briefId,
  assigneeId,
}: {
  briefId: string;
  assigneeId: string | null;
}) {
  const { data: team = [] } = useTeam();
  const update = useUpdateBriefAssignee();
  const [open, setOpen] = useState(false);

  const current = team.find((t) => t.id === assigneeId);

  const set = async (next: string | null) => {
    setOpen(false);
    try {
      await update.mutateAsync({ id: briefId, assigneeId: next });
    } catch (e) {
      toast.error(`Assign failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <User className="h-4 w-4" />
          {current?.full_name ?? "Unassigned"}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-body-medium hover:bg-m-surface-container"
          onClick={() => set(null)}
        >
          <X className="h-4 w-4" />
          Unassigned
        </button>
        <div className="my-1 h-px bg-m-outline-variant" />
        {team.map((t) => (
          <button
            key={t.id}
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-body-medium hover:bg-m-surface-container"
            onClick={() => set(t.id)}
          >
            <User className="h-4 w-4" />
            {t.full_name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Run typecheck**

`npm run typecheck` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/inbox/AssigneePicker.tsx
git commit -m "feat(inbox): AssigneePicker popover"
```

---

## Task 9: `InternalNoteComposer` component

**Files:**
- Create: `src/components/inbox/InternalNoteComposer.tsx`

- [ ] **Step 1: Write it**

Create `src/components/inbox/InternalNoteComposer.tsx`:

```tsx
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAddInternalNote } from "@/hooks/useBriefMessages";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export function InternalNoteComposer({ briefId }: { briefId: string }) {
  const [text, setText] = useState("");
  const { user } = useAuth();
  const addNote = useAddInternalNote(briefId);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    if (!user?.email) {
      toast.error("Sign in to post notes");
      return;
    }
    try {
      await addNote.mutateAsync({ body_text: body, author_email: user.email });
      setText("");
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-2 border-t border-m-outline-variant p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add an internal note (visible to team, not to the client)…"
        rows={2}
        className="resize-none"
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={addNote.isPending || !text.trim()}>
          <Send className="h-3 w-3" />
          Post note
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm `Textarea` exists**

Run: `ls src/components/ui/textarea.tsx`. If it does not exist, copy a minimal one from shadcn and place it there:

```tsx
// src/components/ui/textarea.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-m-outline-variant bg-m-surface px-3 py-2 text-body-medium placeholder:text-m-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m-primary",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
```

- [ ] **Step 3: Run typecheck + commit**

`npm run typecheck` → clean.

```bash
git add src/components/inbox/InternalNoteComposer.tsx src/components/ui/textarea.tsx
git commit -m "feat(inbox): InternalNoteComposer + Textarea component"
```

---

## Task 10: `TriageActions` component (extracted from old BriefRow)

**Files:**
- Create: `src/components/inbox/TriageActions.tsx`

Lift the Accept/Needs-info/Spam workflow from `src/components/BriefRow.tsx` into a standalone component. Behaviour identical — only the container changes.

- [ ] **Step 1: Write the component**

Create `src/components/inbox/TriageActions.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { useUpdateBrief } from "@/hooks/useBriefs";
import { useClients, useCreateClient } from "@/hooks/useClients";
import { useCurrentUserId } from "@/context/AuthContext";
import { needsInfoReply } from "@/content/email-templates";
import { mailto } from "@/lib/mailto";
import { errorMessage } from "@/lib/utils";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

export function TriageActions({ brief }: { brief: Brief }) {
  const navigate = useNavigate();
  const userId = useCurrentUserId();
  const [clientId, setClientId] = useState<string | undefined>(brief.client_id ?? undefined);
  const [newClientName, setNewClientName] = useState("");
  const { data: clients = [] } = useClients();
  const createClient = useCreateClient();
  const update = useUpdateBrief();

  const accept = async () => {
    try {
      let cid = clientId;
      if (!cid && newClientName) {
        const c = await createClient.mutateAsync({ name: newClientName });
        cid = c.id;
      }
      if (!cid) {
        toast.error("Assign a client before accepting");
        return;
      }
      await update.mutateAsync({
        id: brief.id,
        patch: {
          client_id: cid,
          status: "triaged",
          triaged_by: userId,
          triaged_at: new Date().toISOString(),
        },
      });
      navigate(`/briefs/${brief.id}/scope`);
    } catch (e) {
      toast.error(`Accept failed: ${errorMessage(e)}`);
    }
  };

  const spam = async () => {
    const reason = window.prompt("Reason (optional):") ?? "";
    await update.mutateAsync({
      id: brief.id,
      patch: {
        status: "spam",
        rejection_reason: reason || null,
        triaged_by: userId,
        triaged_at: new Date().toISOString(),
      },
    });
    toast.success("Moved to spam");
  };

  const needsInfo = async () => {
    if (!brief.sender_email) {
      toast.error("No sender email — edit brief first");
      return;
    }
    const { subject, body } = needsInfoReply(brief.raw_subject ?? "your request");
    window.location.href = mailto({ to: brief.sender_email, subject, body });
    await update.mutateAsync({
      id: brief.id,
      patch: {
        status: "needs_info",
        triaged_by: userId,
        triaged_at: new Date().toISOString(),
      },
    });
  };

  return (
    <div className="space-y-3 border-t border-m-outline-variant p-3">
      {!brief.client_id && (
        <div className="space-y-2">
          <div className="text-label-large">Assign client</div>
          <Combobox
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            value={clientId ?? ""}
            onChange={setClientId}
            placeholder="Search existing clients…"
          />
          <Input
            placeholder="Or create new client (name)"
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={accept}>Accept</Button>
        <Button variant="secondary" onClick={needsInfo}>Needs info</Button>
        <Button variant="ghost" onClick={spam}>Spam</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/inbox/TriageActions.tsx
git commit -m "feat(inbox): TriageActions component (lifted from BriefRow)"
```

---

## Task 11: `BriefConversation` component

**Files:**
- Create: `src/components/inbox/BriefConversation.tsx`

- [ ] **Step 1: Write the conversation pane**

Create `src/components/inbox/BriefConversation.tsx`:

```tsx
import { Link } from "react-router-dom";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBriefMessages } from "@/hooks/useBriefMessages";
import { useBriefDownstream } from "@/hooks/useBriefDownstream";
import { useClients } from "@/hooks/useClients";
import { useBrief } from "@/hooks/useBriefs";
import { MessageItem } from "./MessageItem";
import { AssigneePicker } from "./AssigneePicker";
import { InternalNoteComposer } from "./InternalNoteComposer";
import { TriageActions } from "./TriageActions";
import { STATUS_LABEL } from "@/lib/brief-routing";
import type { Database } from "@/types/db";

type BriefMessage = Database["public"]["Tables"]["brief_messages"]["Row"];

export function BriefConversation({
  briefId,
  onClose,
}: {
  briefId: string;
  onClose: () => void;
}) {
  const { data: brief } = useBrief(briefId);
  const { data: messages = [] } = useBriefMessages(briefId);
  const { data: downstream } = useBriefDownstream(briefId);
  const { data: clients = [] } = useClients();

  if (!brief) return <div className="p-6 text-body-medium">Loading…</div>;

  const clientName = brief.client_id
    ? clients.find((c) => c.id === brief.client_id)?.name
    : undefined;

  // Synthesize a single message from briefs.raw_body for legacy briefs that
  // pre-date Phase 1 (no brief_messages rows).
  const displayMessages: BriefMessage[] =
    messages.length > 0
      ? messages
      : [
          {
            id: brief.id,
            brief_id: brief.id,
            gmail_message_id: `legacy-${brief.id}`,
            direction: "inbound",
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
            created_at: brief.created_at,
          },
        ];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-m-outline-variant p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-title-medium">{brief.raw_subject ?? "(no subject)"}</h2>
            <Badge variant="secondary">{STATUS_LABEL[brief.status]}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-2 text-label-small text-m-on-surface-variant">
            {clientName && <Badge>Client: {clientName}</Badge>}
            <span>{brief.sender_email ?? "manual"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AssigneePicker briefId={brief.id} assigneeId={brief.assignee_id} />
          {downstream && downstream.kind !== "none" && (
            <Button asChild size="sm" variant="outline">
              <Link to={downstream.href}>
                {downstream.label}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {displayMessages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}
      </div>

      {brief.status === "new" && <TriageActions brief={brief} />}
      <InternalNoteComposer briefId={brief.id} />
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

`npm run typecheck` → expect clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/inbox/BriefConversation.tsx
git commit -m "feat(inbox): BriefConversation pane"
```

---

## Task 12: `BriefRowV2` component

**Files:**
- Create: `src/components/inbox/BriefRowV2.tsx`

- [ ] **Step 1: Write the row**

Create `src/components/inbox/BriefRowV2.tsx`:

```tsx
import { Link } from "react-router-dom";
import { MessageSquare, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTeam } from "@/hooks/useTeam";
import { useClients } from "@/hooks/useClients";
import { useBriefDownstream } from "@/hooks/useBriefDownstream";
import { relativeTime } from "@/lib/relative-time";
import { STATUS_LABEL } from "@/lib/brief-routing";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

export function BriefRowV2({
  brief,
  active,
}: {
  brief: Brief;
  active: boolean;
}) {
  const { data: team = [] } = useTeam();
  const { data: clients = [] } = useClients();
  const { data: downstream } = useBriefDownstream(brief.id);

  const assignee = team.find((t) => t.id === brief.assignee_id);
  const clientName = brief.client_id
    ? clients.find((c) => c.id === brief.client_id)?.name
    : undefined;
  const lastTime = brief.last_message_at ?? brief.received_at;

  return (
    <Link to={`/inbox/${brief.id}`} className="block">
      <Card
        className={cn(
          "p-3 transition-colors hover:bg-m-surface-container",
          active && "ring-2 ring-m-primary",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-title-small">
                {brief.raw_subject ?? "(no subject)"}
              </span>
              {brief.message_count > 1 && (
                <span className="flex items-center gap-0.5 text-label-small text-m-on-surface-variant">
                  <MessageSquare className="h-3 w-3" />
                  {brief.message_count}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-label-small text-m-on-surface-variant">
              <span className="truncate">{clientName ?? brief.sender_email ?? "manual"}</span>
              <span>·</span>
              <span>{relativeTime(lastTime)}</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              {downstream && downstream.kind !== "none" && (
                <Badge variant="outline" className="text-label-small">
                  {downstream.label}
                </Badge>
              )}
              <Badge variant={brief.status === "new" ? "default" : "secondary"}>
                {STATUS_LABEL[brief.status]}
              </Badge>
            </div>
            <span className="flex items-center gap-1 text-label-small text-m-on-surface-variant">
              <User className="h-3 w-3" />
              {assignee?.full_name ?? "—"}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/inbox/BriefRowV2.tsx
git commit -m "feat(inbox): BriefRowV2 list-row component"
```

---

## Task 13: `BriefList` component

**Files:**
- Create: `src/components/inbox/BriefList.tsx`

- [ ] **Step 1: Write the list**

Create `src/components/inbox/BriefList.tsx`:

```tsx
import { useBriefsByScope } from "@/hooks/useBriefs";
import { useCurrentUserId } from "@/context/AuthContext";
import { BriefRowV2 } from "./BriefRowV2";

type Scope = "mine" | "unassigned" | "waiting" | "all";

const EMPTY_COPY: Record<Scope, string> = {
  mine: "Nothing assigned to you.",
  unassigned: "No unassigned briefs.",
  waiting: "No briefs awaiting client info.",
  all: "Inbox is empty.",
};

export function BriefList({
  scope,
  activeBriefId,
}: {
  scope: Scope;
  activeBriefId: string | null;
}) {
  const userId = useCurrentUserId();
  const { data: briefs = [], isLoading } = useBriefsByScope(scope, userId);

  if (isLoading) {
    return <div className="p-4 text-body-medium text-m-on-surface-variant">Loading…</div>;
  }
  if (briefs.length === 0) {
    return <div className="p-4 text-body-medium text-m-on-surface-variant">{EMPTY_COPY[scope]}</div>;
  }

  return (
    <div className="space-y-2 p-2">
      {briefs.map((b) => (
        <BriefRowV2 key={b.id} brief={b} active={b.id === activeBriefId} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/inbox/BriefList.tsx
git commit -m "feat(inbox): BriefList tab body"
```

---

## Task 14: Rewrite `Inbox.tsx`

**Files:**
- Modify: `src/pages/Inbox.tsx` (full rewrite)
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the `/inbox/:briefId` route alias**

Edit `src/App.tsx`. Add a route immediately after the existing `<Route path="inbox" element={<Inbox />} />`:

```tsx
<Route path="inbox/:briefId" element={<Inbox />} />
```

The component reads `useParams` to decide which brief's pane to show.

- [ ] **Step 2: Rewrite `Inbox.tsx`**

Overwrite `src/pages/Inbox.tsx` (replacing the entire current 135-line file):

```tsx
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { BriefList } from "@/components/inbox/BriefList";
import { BriefConversation } from "@/components/inbox/BriefConversation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrentUserId } from "@/context/AuthContext";

const TABS = [
  { id: "mine", label: "Mine" },
  { id: "unassigned", label: "Unassigned" },
  { id: "waiting", label: "Waiting" },
  { id: "all", label: "All" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Inbox() {
  const { briefId } = useParams<{ briefId: string }>();
  const navigate = useNavigate();
  const userId = useCurrentUserId();
  const defaultTab: TabId = userId ? "mine" : "all";
  const closePane = () => navigate("/inbox");

  return (
    <div className="container mx-auto max-w-7xl p-4">
      <div className="mb-4 flex items-end justify-between">
        <h1 className="text-headline-medium">Inbox</h1>
        <Button asChild>
          <Link to="/briefs/new">
            <Plus className="h-4 w-4" /> New brief
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Tabs defaultValue={defaultTab} className="min-w-0">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-2">
              <BriefList scope={t.id} activeBriefId={briefId ?? null} />
            </TabsContent>
          ))}
        </Tabs>

        {/* Desktop: side pane */}
        <aside className="hidden min-h-[60vh] rounded-md border border-m-outline-variant lg:block">
          {briefId ? (
            <BriefConversation briefId={briefId} onClose={closePane} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-body-medium text-m-on-surface-variant">
              Select a brief to open the conversation.
            </div>
          )}
        </aside>
      </div>

      {/* Mobile: full-screen modal */}
      <Dialog open={!!briefId} onOpenChange={(o) => !o && closePane()}>
        <DialogContent className="h-[100dvh] max-w-full p-0 lg:hidden">
          <DialogTitle className="sr-only">Brief conversation</DialogTitle>
          {briefId && <BriefConversation briefId={briefId} onClose={closePane} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

`npm run typecheck` → expect clean.

- [ ] **Step 4: Run dev server smoke**

Run: `npm run dev` → open http://localhost:5174/inbox.

Expected:
- Tabs render: Mine / Unassigned / Waiting / All.
- Default tab when signed in as `brendan@convertedclick.co.za` is **Mine**.
- Click a brief → URL becomes `/inbox/:id`, pane opens with the brief's subject + messages.
- Click X or another brief → pane closes / switches.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Inbox.tsx src/App.tsx
git commit -m "feat(inbox): rewrite Inbox.tsx — tabs + conversation pane"
```

---

## Task 15: Delete legacy `BriefRow.tsx`

**Files:**
- Delete: `src/components/BriefRow.tsx`

- [ ] **Step 1: Confirm there are no other importers**

Run: `grep -rn "from \"@/components/BriefRow\"\\|from '@/components/BriefRow'" src/`

Expected: zero results (the only importer was `src/pages/Inbox.tsx`, which has been rewritten).

- [ ] **Step 2: Delete the file**

Run: `git rm src/components/BriefRow.tsx`

- [ ] **Step 3: Run typecheck + commit**

`npm run typecheck` → clean.

```bash
git commit -m "refactor(inbox): drop legacy BriefRow"
```

---

## Task 16: Component test — `MessageItem` snapshots

**Files:**
- Create: `src/components/inbox/MessageItem.test.tsx`

- [ ] **Step 1: Write three snapshot tests**

Create `src/components/inbox/MessageItem.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MessageItem } from "./MessageItem";
import type { Database } from "@/types/db";

type BriefMessage = Database["public"]["Tables"]["brief_messages"]["Row"];

const base: BriefMessage = {
  id: "00000000-0000-0000-0000-000000000001",
  brief_id: "00000000-0000-0000-0000-000000000099",
  gmail_message_id: "msg-1",
  direction: "inbound",
  from_email: "alice@example.com",
  from_name: "Alice",
  to_emails: ["brendan@convertedclick.co.za"],
  cc_emails: [],
  subject: "Hello",
  body_text: "Hi Brendan, can you scope this?",
  body_html: "<p>Hi Brendan, can you scope this?</p>",
  attachments: [],
  sent_at: "2026-05-05T10:00:00Z",
  relayed_by: "brendan@convertedclick.co.za",
  created_at: "2026-05-05T10:00:00Z",
};

describe("MessageItem", () => {
  it("renders inbound variant with sanitised HTML", () => {
    const { container } = render(<MessageItem message={base} />);
    expect(container.textContent).toContain("Alice");
    expect(container.querySelector(".email-body")).not.toBeNull();
  });

  it("renders outbound variant aligned right", () => {
    const { container } = render(<MessageItem message={{ ...base, direction: "outbound" }} />);
    expect(container.querySelector(".justify-end")).not.toBeNull();
  });

  it("renders note variant as a yellow card", () => {
    const note: BriefMessage = {
      ...base,
      direction: "note",
      body_text: "Internal: client asked for a discount over the phone.",
      body_html: null,
    };
    const { container, getByText } = render(<MessageItem message={note} />);
    expect(container.querySelector(".bg-amber-50")).not.toBeNull();
    expect(getByText(/Internal note/)).not.toBeNull();
  });

  it("strips dangerous HTML before rendering", () => {
    const { container } = render(
      <MessageItem
        message={{ ...base, body_html: '<p>ok</p><script>alert(1)</script>' }}
      />,
    );
    expect(container.innerHTML).not.toContain("<script");
  });
});
```

- [ ] **Step 2: Run — expect 4/4 pass**

Run: `npm test -- MessageItem` → 4 passed.

- [ ] **Step 3: Commit**

```bash
git add src/components/inbox/MessageItem.test.tsx
git commit -m "test(inbox): MessageItem variant snapshots"
```

---

## Task 17: Manual end-to-end test (Brendan)

No code changes. Brendan + one teammate use the new inbox for ≥ 3 days of real briefs before signing off Phase 2.

- [ ] **Step 1: Functional smoke**

In the running dev server:
1. Open `/inbox` — confirm Mine is default for `brendan@convertedclick.co.za`.
2. Switch tabs — Unassigned and All show briefs; Waiting shows only `needs_info`.
3. Click a brief — pane opens. Click another brief — pane swaps. Click X — pane closes.
4. Assign a brief to a teammate via the picker — it disappears from Mine, appears in their Mine.
5. Post an internal note — note appears immediately in the timeline.
6. Apps Script relay (Phase 1) for an open brief — new message appears live within ~5s without refresh (Realtime).

- [ ] **Step 2: Sign off**

Capture sign-off in the spec or a wiki note. If green: proceed to Phase 3.

If anything fails: fix; do not roll out further.

---

## Self-review checklist

- [x] Migration covers `assignee_id` + Realtime publication
- [x] All four tabs implemented with correct filters (Mine via `currentUserId`, Unassigned via `is null`, Waiting via `status='needs_info'`, All)
- [x] Conversation pane covers: subject, status badge, client chip, assignee picker, downstream chip, X close, message timeline, triage actions when `status='new'`, internal note composer
- [x] HTML sanitisation in place; attachment list rendered; legacy briefs synthesise a single inbound message
- [x] Realtime subscription on `brief_messages` per open brief; 30s refetch fallback
- [x] DOMPurify added; allow-list matches spec § "HTML rendering safety"
- [x] All file paths exact; no placeholders; types and method names consistent across tasks
- [x] Commits frequent and on natural boundaries
- [x] Plan-level decisions documented (no virtualisation in v1, triage actions in pane)
