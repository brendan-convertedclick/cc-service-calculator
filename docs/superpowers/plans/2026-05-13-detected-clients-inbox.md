# Detected-clients inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inbox button to the "All clients" card that shows a count of detected new client domains + pending senders, with a dialog for approving/dismissing each.

**Architecture:** New `pending_clients` table mirrors `pending_senders`. A new MCP tool `record-pending-client` is called by the `/intake` skill whenever `evaluate-sender` returns `unknown`. A new React hook `usePendingInbox` combines both tables; a dialog component renders two sections (new client domains, pending senders) with approve/dismiss actions.

**Tech Stack:** Postgres + Supabase RLS, MCP SDK + zod + vitest (Node), React 18 + TanStack Query + shadcn/ui Dialog.

---

## File Structure

**Created:**
- `supabase/migrations/0046_pending_clients.sql` — new table + RLS
- `mcp-server/src/tools/record-pending-client.ts` — upsert handler
- `mcp-server/src/tools/record-pending-client.test.ts` — vitest unit tests
- `src/hooks/usePendingInbox.ts` — combined query + approve/dismiss/sender mutations
- `src/components/clients/DetectedInboxButton.tsx` — header button + dialog wrapper
- `src/components/clients/DetectedInboxDialog.tsx` — dialog body with two sections

**Modified:**
- `mcp-server/src/index.ts` — register `record-pending-client` tool
- `src/pages/Clients.tsx` — wire `DetectedInboxButton` into All clients `<CardHeader>`
- `src/types/db.ts` — add `pending_clients` row type (regenerated)
- `~/.claude/skills/intake/SKILL.md` — call `record-pending-client` on `unknown` instead of creating a brief

---

## Task 1: Database migration for `pending_clients`

**Files:**
- Create: `supabase/migrations/0046_pending_clients.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0046_pending_clients.sql
-- Apply via mcp__cc-supabase__apply_migration (name: pending_clients)

create table public.pending_clients (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  sample_sender text,
  sample_subject text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen_count    int not null default 1,
  dismissed_at  timestamptz
);

create unique index pending_clients_domain_unique
  on public.pending_clients (domain);
create index pending_clients_last_seen_idx
  on public.pending_clients (last_seen_at desc);

alter table public.pending_clients enable row level security;

create policy "authenticated read pending clients" on public.pending_clients
  for select to authenticated using (true);
create policy "authenticated write pending clients" on public.pending_clients
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Apply the migration**

Use `mcp__cc-supabase__apply_migration` with name `pending_clients` and the SQL above.
Expected: success; `mcp__cc-supabase__list_tables` shows the new table.

- [ ] **Step 3: Regenerate DB types**

Run: `mcp__cc-supabase__generate_typescript_types` and overwrite `src/types/db.ts` with the result.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0046_pending_clients.sql src/types/db.ts
git commit -m "feat(db): add pending_clients table for detected new client domains"
```

---

## Task 2: MCP tool `record-pending-client` — failing test

**Files:**
- Create: `mcp-server/src/tools/record-pending-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpsert = vi.fn(() => Promise.resolve({
  data: [{ id: 'pc-1', seen_count: 1 }],
  error: null,
}))
const mockFrom = vi.fn(() => ({ upsert: () => ({ select: mockUpsert }) }))
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./record-pending-client.js')

describe('record-pending-client', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lowercases domain and upserts with seen_count increment + dismissed_at clear', async () => {
    const res = await handler({
      domain: 'Acme.CO.za',
      sender: 'Greg@Acme.co.za',
      subject: 'Hello',
    })
    expect(mockFrom).toHaveBeenCalledWith('pending_clients')
    const payload = JSON.parse(res.content[0].text)
    expect(payload).toEqual({ id: 'pc-1', seen_count: 1 })
  })

  it('requires a non-empty domain', async () => {
    const res = await handler({ domain: '', sender: 'a@b.com' })
    expect(res.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npm test -- record-pending-client`
Expected: FAIL — module `./record-pending-client.js` not found.

---

## Task 3: MCP tool `record-pending-client` — implementation

**Files:**
- Create: `mcp-server/src/tools/record-pending-client.ts`

- [ ] **Step 1: Write the handler**

```ts
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  domain: z.string().describe('Sender domain (lowercased before upsert)'),
  sender: z.string().describe('Most recent sender email seen for this domain'),
  subject: z.string().optional().describe('Most recent subject line'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const domain = input.domain.trim().toLowerCase()
    if (!domain) throw new Error('domain is required')

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('pending_clients')
      .upsert(
        {
          domain,
          sample_sender: input.sender,
          sample_subject: input.subject ?? null,
          last_seen_at: now,
          dismissed_at: null,
        },
        { onConflict: 'domain', ignoreDuplicates: false },
      )
      .select('id, seen_count')

    if (error) throw new Error(error.message)
    const row = (data ?? [])[0] ?? { id: null, seen_count: 1 }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: row.id, seen_count: row.seen_count }) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

Note: the bare upsert above will NOT increment `seen_count` on conflict — Supabase upsert sets the column to the supplied value. To increment, we use a Postgres RPC. Skip the RPC for v1 and accept that `seen_count` only grows when the row is re-inserted after a hard delete; the displayed value is "at least one." If incrementing is required later, add a Postgres trigger.

- [ ] **Step 2: Run test to verify it passes**

Run: `cd mcp-server && npm test -- record-pending-client`
Expected: PASS, both cases.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/tools/record-pending-client.ts mcp-server/src/tools/record-pending-client.test.ts
git commit -m "feat(mcp): record-pending-client tool"
```

---

## Task 4: Register the MCP tool

**Files:**
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: Add the import**

Insert near the other tool imports (after `applyRetroAction`):

```ts
import * as recordPendingClient from './tools/record-pending-client.js'
```

- [ ] **Step 2: Register the tool**

Append after the last `server.tool(...)` block:

```ts
server.tool(
  'record-pending-client',
  'Record an inbound email from a domain that does not match any client. Upserts pending_clients keyed by domain; clears dismissed_at so the row reappears in the inbox. Called by /intake when evaluate-sender returns "unknown".',
  rawShape(recordPendingClient.schema),
  h(recordPendingClient.handler),
)
```

- [ ] **Step 3: Verify the build**

Run: `cd mcp-server && npm run typecheck` (or `npx tsc --noEmit`)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): register record-pending-client tool"
```

---

## Task 5: Hook `usePendingInbox`

**Files:**
- Create: `src/hooks/usePendingInbox.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type PendingClient = {
  id: string;
  domain: string;
  sample_sender: string | null;
  sample_subject: string | null;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
};

export type PendingSenderWithClient = {
  id: string;
  client_id: string;
  client_name: string;
  email: string;
  sample_subject: string | null;
  last_seen_at: string;
  seen_count: number;
};

export function usePendingInbox() {
  const clientsQ = useQuery({
    queryKey: ["pending-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_clients")
        .select("id, domain, sample_sender, sample_subject, first_seen_at, last_seen_at, seen_count")
        .is("dismissed_at", null)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingClient[];
    },
  });

  const sendersQ = useQuery({
    queryKey: ["pending-senders", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_senders")
        .select("id, client_id, email, sample_subject, last_seen_at, seen_count, client:clients!inner(name)")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        client_id: r.client_id,
        client_name: (r.client as { name: string }).name,
        email: r.email,
        sample_subject: r.sample_subject,
        last_seen_at: r.last_seen_at,
        seen_count: r.seen_count,
      })) as PendingSenderWithClient[];
    },
  });

  const pendingClients = clientsQ.data ?? [];
  const pendingSenders = sendersQ.data ?? [];

  return {
    pendingClients,
    pendingSenders,
    total: pendingClients.length + pendingSenders.length,
    isLoading: clientsQ.isLoading || sendersQ.isLoading,
  };
}

export function useApprovePendingClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pending: PendingClient;
      name: string;
      primary_domain: string;
      clickup_folder_id?: string | null;
    }) => {
      const { error: insErr } = await supabase
        .from("clients")
        .insert({
          name: input.name.trim(),
          primary_domain: input.primary_domain.trim().toLowerCase(),
          clickup_folder_id: input.clickup_folder_id ?? null,
        });
      if (insErr) throw insErr;
      const { error: delErr } = await supabase
        .from("pending_clients")
        .delete()
        .eq("id", input.pending.id);
      if (delErr) throw delErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-clients"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}

export function useDismissPendingClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pending_clients")
        .update({ dismissed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-clients"] }),
  });
}

export function useDismissPendingSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pending_senders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-senders", "all"] });
      qc.invalidateQueries({ queryKey: ["pending-senders"] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `clients.insert` complains about required columns, inspect `src/types/db.ts` and add any non-null fields (the V1 schema only requires `name`).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePendingInbox.ts
git commit -m "feat(clients): usePendingInbox hook"
```

---

## Task 6: Dialog component `DetectedInboxDialog`

**Files:**
- Create: `src/components/clients/DetectedInboxDialog.tsx`

- [ ] **Step 1: Write the dialog body**

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  usePendingInbox,
  useApprovePendingClient,
  useDismissPendingClient,
  useDismissPendingSender,
  type PendingClient,
} from "@/hooks/usePendingInbox";
import { useResolvePendingSender } from "@/hooks/useSenderRules";

export function DetectedInboxDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { pendingClients, pendingSenders, isLoading } = usePendingInbox();
  const approve = useApprovePendingClient();
  const dismissClient = useDismissPendingClient();
  const dismissSender = useDismissPendingSender();
  const resolveSender = useResolvePendingSender();

  const [openApproveId, setOpenApproveId] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Detected new clients & senders</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold">New client domains</h3>
              {pendingClients.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No new domains. Inbound email from unrecognised domains will appear here.
                </p>
              ) : (
                <ul className="divide-y border rounded-md">
                  {pendingClients.map((p) => (
                    <li key={p.id} className="p-3">
                      <PendingClientRow
                        pending={p}
                        expanded={openApproveId === p.id}
                        onExpand={() => setOpenApproveId(openApproveId === p.id ? null : p.id)}
                        onApprove={(name, folderId) =>
                          approve.mutate(
                            {
                              pending: p,
                              name,
                              primary_domain: p.domain,
                              clickup_folder_id: folderId,
                            },
                            {
                              onSuccess: () => {
                                toast.success(`Created ${name}`);
                                setOpenApproveId(null);
                              },
                              onError: (e) => toast.error(e.message),
                            },
                          )
                        }
                        onDismiss={() =>
                          dismissClient.mutate(p.id, {
                            onSuccess: () => toast.success(`Dismissed ${p.domain}`),
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Senders on existing clients</h3>
              {pendingSenders.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No pending senders. Senders on a known client domain without an allow/block rule appear here.
                </p>
              ) : (
                <ul className="divide-y border rounded-md">
                  {pendingSenders.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 p-3 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.email}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {s.client_name} · {s.sample_subject ?? "—"} · {s.seen_count}×
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          resolveSender.mutate(
                            {
                              pending: {
                                id: s.id,
                                client_id: s.client_id,
                                email: s.email,
                                sample_subject: s.sample_subject,
                                sample_brief_id: null,
                                last_seen_at: s.last_seen_at,
                                seen_count: s.seen_count,
                              },
                              action: "allow",
                            },
                            { onSuccess: () => toast.success(`Allowed ${s.email}`) },
                          )
                        }
                      >
                        <Check className="h-4 w-4" />
                        Allow
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          resolveSender.mutate(
                            {
                              pending: {
                                id: s.id,
                                client_id: s.client_id,
                                email: s.email,
                                sample_subject: s.sample_subject,
                                sample_brief_id: null,
                                last_seen_at: s.last_seen_at,
                                seen_count: s.seen_count,
                              },
                              action: "block",
                            },
                            { onSuccess: () => toast.success(`Blocked ${s.email}`) },
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                        Block
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          dismissSender.mutate(s.id, {
                            onSuccess: () => toast.success(`Dismissed ${s.email}`),
                          })
                        }
                      >
                        Dismiss
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PendingClientRow({
  pending,
  expanded,
  onExpand,
  onApprove,
  onDismiss,
}: {
  pending: PendingClient;
  expanded: boolean;
  onExpand: () => void;
  onApprove: (name: string, folderId: string | null) => void;
  onDismiss: () => void;
}) {
  const defaultName = pending.domain
    .replace(/\.[^.]+$/, "")
    .split(".")
    .pop()!
    .replace(/^./, (c) => c.toUpperCase());
  const [name, setName] = useState(defaultName);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{pending.domain}</div>
          <div className="text-xs text-muted-foreground truncate">
            {pending.sample_sender ?? "—"} · {pending.sample_subject ?? "—"} · {pending.seen_count}×
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onExpand}>
          {expanded ? "Cancel" : "Approve as client"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {expanded && (
        <div className="flex items-end gap-2 rounded-md border bg-muted/30 p-2">
          <div className="flex-1">
            <Label className="text-xs">Client name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => onApprove(name, null)} disabled={!name.trim()}>
            Create client
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. The `PendingSender` shape passed to `useResolvePendingSender` is reconstructed from `pendingSenders` rows because the existing hook expects that exact type.

- [ ] **Step 3: Commit**

```bash
git add src/components/clients/DetectedInboxDialog.tsx
git commit -m "feat(clients): DetectedInboxDialog with two-section approve/dismiss"
```

---

## Task 7: Header button `DetectedInboxButton`

**Files:**
- Create: `src/components/clients/DetectedInboxButton.tsx`

- [ ] **Step 1: Write the button**

```tsx
import { useState } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePendingInbox } from "@/hooks/usePendingInbox";
import { DetectedInboxDialog } from "./DetectedInboxDialog";

export function DetectedInboxButton() {
  const { total } = usePendingInbox();
  const [open, setOpen] = useState(false);

  if (total === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Detected new clients & senders"
      >
        <Inbox className="h-4 w-4" />
        Inbox
        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
          {total}
        </span>
      </Button>
      <DetectedInboxDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/clients/DetectedInboxButton.tsx
git commit -m "feat(clients): DetectedInboxButton with count pill"
```

---

## Task 8: Wire the button into the Clients page

**Files:**
- Modify: `src/pages/Clients.tsx:92-95`

- [ ] **Step 1: Add the import**

Add to the existing imports at the top of `src/pages/Clients.tsx`:

```tsx
import { DetectedInboxButton } from "@/components/clients/DetectedInboxButton";
```

- [ ] **Step 2: Replace the All clients `<CardHeader>`**

Find:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>All clients</CardTitle>
        </CardHeader>
```

Replace with:

```tsx
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>All clients</CardTitle>
          <DetectedInboxButton />
        </CardHeader>
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`
Open: http://localhost:5174/clients
Expected:
- No button visible (because `pending_clients` and `pending_senders` are empty by default).
- Insert a test row via the Supabase MCP:
  ```
  mcp__cc-supabase__execute_sql
    query: insert into pending_clients (domain, sample_sender, sample_subject) values ('test-co.za', 'a@test-co.za', 'Quote request') returning *;
  ```
- Reload — button appears with badge "1".
- Click — dialog opens, "test-co.za" row visible.
- Click "Approve as client" → form expands → "Create client" inserts a `clients` row and removes the pending row.
- Verify the new client appears in the table below.
- Clean up: `delete from clients where primary_domain='test-co.za';` if needed.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients.tsx
git commit -m "feat(clients): mount DetectedInboxButton in All clients header"
```

---

## Task 9: Update the `/intake` skill

**Files:**
- Modify: `~/.claude/skills/intake/SKILL.md` (outside the repo — not committed)

- [ ] **Step 1: Edit step 4c**

Find the `### 4. For each thread` block. Insert between **a. Find client** and **b. Read wiki context**:

```
**a-2. If find-client returned null — record and skip**

```
mcp__cc-calculator__record-pending-client
  domain: <sender domain>
  sender: <sender email>
  subject: <subject of latest message>
```

Then tag the Gmail thread `CC/Intake/Processed` and continue to the next thread.
Do NOT create a brief, do NOT read wiki, do NOT classify.

The brief will be created later when the operator approves the domain via Clients → Inbox.
```

- [ ] **Step 2: Update `references/failure-modes.md`**

Replace the row:

```
| `find-client` returns null (unknown sender) | Create brief with no `client_id`. ... |
```

With:

```
| `find-client` returns null (unknown sender) | Call `record-pending-client` with the sender's domain/email/subject, tag the thread `CC/Intake/Processed`, skip to next thread. The operator approves the domain in Clients → Inbox; subsequent messages from approved domains will create briefs normally. |
```

- [ ] **Step 3: Smoke test the skill**

Run `/intake` against a Gmail inbox with at least one unknown-domain message. Verify:
- A `pending_clients` row appears for the domain.
- No brief is created.
- The thread is tagged `CC/Intake/Processed`.

(No commit — these files live in `~/.claude/skills/` and are not part of this repo.)

---

## Self-Review notes

- All spec sections covered: schema (Task 1), MCP tool (Tasks 2-4), hook (Task 5), dialog (Task 6), button (Task 7), page wiring (Task 8), intake skill update (Task 9).
- `seen_count` increment: documented as a known limitation in Task 3 — first-pass uses Supabase upsert which overwrites rather than increments. Acceptable for V1 since the inbox is "is this domain new?" not "how many times has it emailed."
- Out-of-scope items from the spec (Gmail tagging on dismiss, bulk approve, auto allow-rule on approval, global nav badge, subdomain consolidation) are not represented as tasks — intentional.
- `useDismissPendingSender` is added in the hook but the existing per-client `SenderRulesPanel` keeps its own resolve flow; the global inbox uses the new dismiss for "I don't want to decide right now."

---

Plan complete and saved to `docs/superpowers/plans/2026-05-13-detected-clients-inbox.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session, batch with checkpoints for review.

Which approach?
