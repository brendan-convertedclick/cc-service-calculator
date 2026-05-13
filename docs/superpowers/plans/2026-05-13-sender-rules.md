# Client Sender Rules (Whitelist / Blacklist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator whitelist and blacklist sender email addresses (and domain wildcards) per client, with pending-approval for unknown senders on known domains, and a retroactive cleanup prompt that archives or deletes matching briefs.

**Architecture:** A new `client_sender_rules` table holds per-client allow/block patterns. A `pending_senders` table queues unknown senders on known client domains for explicit approval. Enforcement lives in two layers: (1) the cc-calculator MCP layer (a new `evaluate-sender` tool consumed by the `/intake` skill before brief creation, plus a guard inside `create-brief` as a belt-and-braces backstop), and (2) the Inbox UI which filters briefs whose sender is now blocked. A Settings → Clients → [Client] → Senders panel manages the lists. Adding a new block rule opens a modal listing matching synced briefs with per-batch Archive / Delete / Leave actions.

**Tech Stack:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Supabase JS + TanStack Query; cc-calculator MCP server (Node + zod); Supabase Postgres.

---

## File Structure

**New:**
- `supabase/migrations/0044_client_sender_rules.sql` — schema for `client_sender_rules`, `pending_senders`, retro-action audit columns on briefs.
- `mcp-server/src/sender-rules.ts` — pure rule evaluation (`evaluatePattern`, `evaluate`) shared by tools.
- `mcp-server/src/sender-rules.test.ts` — unit tests for the matcher.
- `mcp-server/src/tools/evaluate-sender.ts` — MCP tool returning `{ decision: 'allow' | 'block' | 'pending' | 'unknown', client_id?, rule_id? }`.
- `mcp-server/src/tools/evaluate-sender.test.ts`
- `mcp-server/src/tools/list-sender-rules.ts` — list rules for a client.
- `mcp-server/src/tools/set-sender-rule.ts` — upsert/delete a single rule.
- `mcp-server/src/tools/list-pending-senders.ts` — pending queue, optionally per client.
- `mcp-server/src/tools/resolve-pending-sender.ts` — approve (turn into allow rule) / reject (turn into block rule).
- `mcp-server/src/tools/list-briefs-matching-sender.ts` — preview briefs that a new block rule would affect.
- `mcp-server/src/tools/apply-retro-action.ts` — bulk archive or delete briefs by id list.
- `src/hooks/useSenderRules.ts` — TanStack Query hooks for the five new MCP tools (called via the existing supabase JS client → MCP isn't browser-facing, so these hit Supabase REST directly; see Task 4).
- `src/components/clients/SenderRulesPanel.tsx` — UI panel: Allowed / Blocked / Pending sections.
- `src/components/clients/RetroCleanupDialog.tsx` — post-block-add modal.
- `src/pages/ClientDetail.tsx` — new route `/clients/:id` that hosts the panel (Clients table currently has no detail page).

**Modify:**
- `mcp-server/src/index.ts` — register the new tools.
- `mcp-server/src/tools/create-brief.ts` — call `evaluate` before insert; reject with explicit reason if blocked, queue pending sender if unknown-on-known-domain.
- `mcp-server/src/tools/sync-messages.ts` — same pre-check on inbound message direction so personal threads on a client domain don't accumulate messages on existing personal briefs.
- `src/pages/Clients.tsx` — make each client row name a `<Link>` to `/clients/:id`.
- `src/App.tsx` — register the new route.
- `src/types/db.ts` — regenerated types (post-migration).
- `~/.claude/plugins/.../skills/intake/SKILL.md` (out of repo) — documented as a note in the plan; not edited here.

---

## Task 1: Schema — `client_sender_rules` + `pending_senders`

**Files:**
- Create: `supabase/migrations/0044_client_sender_rules.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0044_client_sender_rules.sql
-- Apply via mcp__cc-supabase__apply_migration (name: client_sender_rules)

create type public.sender_rule_mode as enum ('allow', 'block');

create table public.client_sender_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  pattern text not null,
  mode public.sender_rule_mode not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pattern is either a full email (gregh@thekingscollege.co.za)
-- or a domain wildcard (*@thekingscollege.co.za). Stored lowercased.
create unique index client_sender_rules_unique
  on public.client_sender_rules (client_id, pattern);
create index client_sender_rules_client_idx
  on public.client_sender_rules (client_id);

create table public.pending_senders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sample_subject text,
  sample_brief_id uuid references public.briefs(id) on delete set null,
  seen_count int not null default 1
);
create unique index pending_senders_unique on public.pending_senders (client_id, email);
create index pending_senders_client_idx on public.pending_senders (client_id);

-- RLS — match siblings (clients table is wide-open in V1 single-tenant)
alter table public.client_sender_rules enable row level security;
alter table public.pending_senders enable row level security;

create policy "authenticated read sender rules" on public.client_sender_rules
  for select to authenticated using (true);
create policy "authenticated write sender rules" on public.client_sender_rules
  for all to authenticated using (true) with check (true);

create policy "authenticated read pending senders" on public.pending_senders
  for select to authenticated using (true);
create policy "authenticated write pending senders" on public.pending_senders
  for all to authenticated using (true) with check (true);

-- updated_at trigger reuse
create trigger client_sender_rules_set_updated_at
  before update on public.client_sender_rules
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__cc-supabase__apply_migration` with name `client_sender_rules` and the SQL above.

- [ ] **Step 3: Verify**

```
mcp__cc-supabase__list_tables → confirm client_sender_rules and pending_senders exist.
```

- [ ] **Step 4: Regenerate types**

Run: `mcp__cc-supabase__generate_typescript_types` and overwrite `src/types/db.ts` with the output. Spot-check the diff for the two new tables.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0044_client_sender_rules.sql src/types/db.ts
git commit -m "feat(sender-rules): add client_sender_rules and pending_senders schema"
```

---

## Task 2: Rule matcher (pure)

**Files:**
- Create: `mcp-server/src/sender-rules.ts`
- Test: `mcp-server/src/sender-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mcp-server/src/sender-rules.test.ts
import { describe, it, expect } from 'vitest'
import { evaluatePattern, decide } from './sender-rules.js'

describe('evaluatePattern', () => {
  it('matches exact email case-insensitively', () => {
    expect(evaluatePattern('gregh@x.com', 'GregH@X.com')).toBe(true)
  })
  it('matches *@domain wildcard', () => {
    expect(evaluatePattern('*@x.com', 'anyone@x.com')).toBe(true)
    expect(evaluatePattern('*@x.com', 'anyone@y.com')).toBe(false)
  })
  it('rejects malformed pattern', () => {
    expect(evaluatePattern('x.com', 'a@x.com')).toBe(false)
  })
})

describe('decide', () => {
  const rules = [
    { id: 'r1', pattern: '*@x.com', mode: 'allow' as const },
    { id: 'r2', pattern: 'greg@x.com', mode: 'block' as const },
  ]
  it('block beats allow', () => {
    expect(decide('greg@x.com', rules)).toEqual({ decision: 'block', rule_id: 'r2' })
  })
  it('falls through to allow when no block matches', () => {
    expect(decide('sam@x.com', rules)).toEqual({ decision: 'allow', rule_id: 'r1' })
  })
  it('returns pending when no rule matches and a domain rule exists for the client', () => {
    expect(decide('new@x.com', [])).toEqual({ decision: 'pending' })
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```
cd mcp-server && npm test -- sender-rules
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the matcher**

```ts
// mcp-server/src/sender-rules.ts
export type RuleMode = 'allow' | 'block'
export interface Rule { id: string; pattern: string; mode: RuleMode }
export type Decision =
  | { decision: 'allow'; rule_id: string }
  | { decision: 'block'; rule_id: string }
  | { decision: 'pending' }

export function evaluatePattern(pattern: string, email: string): boolean {
  const p = pattern.trim().toLowerCase()
  const e = email.trim().toLowerCase()
  if (p.startsWith('*@')) return e.endsWith(p.slice(1)) // '*@x.com' → endsWith '@x.com'
  if (!p.includes('@')) return false
  return p === e
}

export function decide(email: string, rules: Rule[]): Decision {
  // Block wins.
  const block = rules.find(r => r.mode === 'block' && evaluatePattern(r.pattern, email))
  if (block) return { decision: 'block', rule_id: block.id }
  const allow = rules.find(r => r.mode === 'allow' && evaluatePattern(r.pattern, email))
  if (allow) return { decision: 'allow', rule_id: allow.id }
  return { decision: 'pending' }
}
```

- [ ] **Step 4: Run tests — expect pass**

```
cd mcp-server && npm test -- sender-rules
```

Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/sender-rules.ts mcp-server/src/sender-rules.test.ts
git commit -m "feat(sender-rules): add pure rule matcher with block-wins semantics"
```

---

## Task 3: MCP tool `evaluate-sender`

**Files:**
- Create: `mcp-server/src/tools/evaluate-sender.ts`
- Test: `mcp-server/src/tools/evaluate-sender.test.ts`
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// mcp-server/src/tools/evaluate-sender.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

const { handler } = await import('./evaluate-sender.js')
const { supabase } = await import('../supabase.js')

describe('evaluate-sender', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns unknown when no client owns the domain', async () => {
    ;(supabase.from as any).mockReturnValue({
      select: () => ({ ilike: () => ({ maybeSingle: () => ({ data: null, error: null }) }) }),
    })
    const res = await handler({ email: 'a@nowhere.com' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'unknown' })
  })
})
```

(Add at least two more cases inline: a block hit and a pending case. Copy the mock shape from `mcp-server/src/tools/find-client.test.ts`.)

- [ ] **Step 2: Run test — expect failure**

```
cd mcp-server && npm test -- evaluate-sender
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the tool**

```ts
// mcp-server/src/tools/evaluate-sender.ts
import { z } from 'zod'
import { supabase } from '../supabase.js'
import { decide, type Rule } from '../sender-rules.js'

export const schema = z.object({
  email: z.string().describe('Sender email — full address'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const email = input.email.toLowerCase()
    const domain = email.split('@')[1] ?? ''

    // 1. Find client by primary_domain
    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id')
      .ilike('primary_domain', domain)
      .maybeSingle()
    if (cErr) throw new Error(cErr.message)
    if (!client) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ decision: 'unknown' }) }] }
    }

    // 2. Load all rules for the client
    const { data: rules, error: rErr } = await supabase
      .from('client_sender_rules')
      .select('id, pattern, mode')
      .eq('client_id', client.id)
    if (rErr) throw new Error(rErr.message)

    const result = decide(email, (rules ?? []) as Rule[])
    const payload =
      result.decision === 'pending'
        ? { decision: 'pending', client_id: client.id }
        : { ...result, client_id: client.id }

    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Register in `mcp-server/src/index.ts`**

Open `mcp-server/src/index.ts`. Add `import * as evaluateSender from './tools/evaluate-sender.js'` near the other tool imports, and add `'evaluate-sender'` plus its handler to the dispatch table — mirror exactly how `sync-messages` is wired (it's listed at line 87 today).

- [ ] **Step 5: Run tests — expect pass**

```
cd mcp-server && npm test -- evaluate-sender
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/tools/evaluate-sender.ts mcp-server/src/tools/evaluate-sender.test.ts mcp-server/src/index.ts
git commit -m "feat(sender-rules): add evaluate-sender MCP tool"
```

---

## Task 4: Gate `create-brief` and `sync-messages` with rule evaluation

**Files:**
- Modify: `mcp-server/src/tools/create-brief.ts`
- Modify: `mcp-server/src/tools/sync-messages.ts`
- Modify: `mcp-server/src/tools/create-brief.test.ts` (add cases)

- [ ] **Step 1: Write the failing test in `create-brief.test.ts`**

Add a case asserting that when `evaluate` returns `block`, `create-brief` returns `{ blocked: true, reason: 'sender_blocked' }` and does NOT insert. Mock `supabase.from('client_sender_rules')` to return a matching block rule.

- [ ] **Step 2: Run — expect failure.**

```
cd mcp-server && npm test -- create-brief
```

- [ ] **Step 3: Update `create-brief.ts` so the flow becomes:**

```ts
// after idempotency check, before insert
if (input.client_id) {
  const { data: rules } = await supabase
    .from('client_sender_rules')
    .select('id, pattern, mode')
    .eq('client_id', input.client_id)
  const { decide } = await import('../sender-rules.js')
  const result = decide(input.sender_email, (rules ?? []) as any)
  if (result.decision === 'block') {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ blocked: true, reason: 'sender_blocked', rule_id: result.rule_id }) }] }
  }
  if (result.decision === 'pending') {
    // Insert brief but flag — we still want to see it in Pending for triage.
    // After the brief insert below, also upsert into pending_senders (see step 4).
  }
}
```

Then after the successful `.insert(...)`, if `decide` returned `pending`, upsert into `pending_senders`:

```ts
if (result?.decision === 'pending') {
  await supabase.from('pending_senders').upsert({
    client_id: input.client_id,
    email: input.sender_email.toLowerCase(),
    sample_subject: input.subject,
    sample_brief_id: created.id,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'client_id,email' })
}
```

(Keep `decide` and `rules` scoped so the existing test continues to pass when no rules exist.)

- [ ] **Step 4: Apply the same pre-check to `sync-messages.ts`**

Before the upsert, group `input.messages` by `from_email` (inbound only), join to the brief's `client_id`, evaluate, and silently drop any whose decision is `block`. Return `{ inserted, skipped, dropped }` where `dropped` counts rule-blocked rows.

- [ ] **Step 5: Run all MCP tests — expect pass**

```
cd mcp-server && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/tools/create-brief.ts mcp-server/src/tools/sync-messages.ts mcp-server/src/tools/create-brief.test.ts
git commit -m "feat(sender-rules): gate create-brief and sync-messages with rule evaluation"
```

---

## Task 5: Tools for managing rules and pending senders

**Files:**
- Create: `mcp-server/src/tools/list-sender-rules.ts`
- Create: `mcp-server/src/tools/set-sender-rule.ts`
- Create: `mcp-server/src/tools/list-pending-senders.ts`
- Create: `mcp-server/src/tools/resolve-pending-sender.ts`
- Modify: `mcp-server/src/index.ts`

Note: tests for these are thin since they're CRUD wrappers — write one happy-path test per tool covering the schema shape and the supabase call. Match the test style of `list-client-domains` (no test file exists today, so it's acceptable to write tests only where logic exists — set-sender-rule lowercases input, resolve-pending-sender writes a rule then deletes the pending row, so both warrant a test).

- [ ] **Step 1: `list-sender-rules`** — input `{ client_id }`, returns `{ allow: Rule[], blocked: Rule[] }`. Selects from `client_sender_rules`, groups in memory by `mode`.

- [ ] **Step 2: `set-sender-rule`** — input `{ client_id, pattern, mode, note? }` (mode: `'allow' | 'block'`). Lowercases the pattern. Upserts on `(client_id, pattern)`; if `mode` differs from existing, updates the row. Also supports `delete: true` to remove.

- [ ] **Step 3: `list-pending-senders`** — input `{ client_id? }`. Returns rows ordered by `last_seen_at desc`.

- [ ] **Step 4: `resolve-pending-sender`** — input `{ pending_id, action: 'allow' | 'block' }`. In one transactional sequence: insert a row in `client_sender_rules` (`pattern` = the email lowercased, `mode` = the action) then delete the pending row.

- [ ] **Step 5: Register all four in `mcp-server/src/index.ts`.**

- [ ] **Step 6: Run tests — expect pass.**

```
cd mcp-server && npm test
```

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools/list-sender-rules.ts mcp-server/src/tools/set-sender-rule.ts mcp-server/src/tools/list-pending-senders.ts mcp-server/src/tools/resolve-pending-sender.ts mcp-server/src/index.ts
git commit -m "feat(sender-rules): add CRUD tools for rules and pending senders"
```

---

## Task 6: Retroactive cleanup tools

**Files:**
- Create: `mcp-server/src/tools/list-briefs-matching-sender.ts`
- Create: `mcp-server/src/tools/apply-retro-action.ts`
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: `list-briefs-matching-sender`** — input `{ client_id, pattern }`. Returns `{ briefs: Array<{ id, raw_subject, sender_email, received_at, status }> }` for briefs in that client whose `sender_email` matches `evaluatePattern(pattern, ...)`. Implement by selecting briefs `where client_id = ?` and filtering in-memory using `evaluatePattern` (small N — a client's briefs).

- [ ] **Step 2: `apply-retro-action`** — input `{ brief_ids: string[], action: 'archive' | 'delete' }`. For `archive`: update `briefs.status = 'archived'` for the ids. For `delete`: delete from `briefs` (cascades to `brief_messages` / `scopes`). Returns `{ affected: number }`.

- [ ] **Step 3: Register both tools in `mcp-server/src/index.ts`.**

- [ ] **Step 4: Test happy paths.**

For `list-briefs-matching-sender` test that a `*@x.com` pattern returns briefs from `a@x.com` and `b@x.com`. For `apply-retro-action` test that `delete` calls `.delete().in('id', ids)`.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools/list-briefs-matching-sender.ts mcp-server/src/tools/apply-retro-action.ts mcp-server/src/tools/*.test.ts mcp-server/src/index.ts
git commit -m "feat(sender-rules): add retroactive cleanup tools"
```

---

## Task 7: Frontend data layer

**Files:**
- Create: `src/hooks/useSenderRules.ts`

> Context: the browser cannot call the MCP server. Browser code must hit Supabase via `@supabase/supabase-js` directly, using the same RLS-authenticated client used by other hooks (see `src/hooks/useClients.ts` for the shape).

- [ ] **Step 1: Implement hooks against Supabase directly**

```ts
// src/hooks/useSenderRules.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'

export type SenderRule = {
  id: string
  client_id: string
  pattern: string
  mode: 'allow' | 'block'
  note: string | null
}
export type PendingSender = {
  id: string
  client_id: string
  email: string
  sample_subject: string | null
  sample_brief_id: string | null
  last_seen_at: string
  seen_count: number
}

export function useSenderRules(clientId: string) {
  return useQuery({
    queryKey: ['sender-rules', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_sender_rules')
        .select('id, client_id, pattern, mode, note')
        .eq('client_id', clientId)
        .order('mode')
      if (error) throw error
      return data as SenderRule[]
    },
  })
}

export function usePendingSenders(clientId: string) {
  return useQuery({
    queryKey: ['pending-senders', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_senders')
        .select('id, client_id, email, sample_subject, sample_brief_id, last_seen_at, seen_count')
        .eq('client_id', clientId)
        .order('last_seen_at', { ascending: false })
      if (error) throw error
      return data as PendingSender[]
    },
  })
}

export function useUpsertSenderRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rule: { client_id: string; pattern: string; mode: 'allow' | 'block'; note?: string | null }) => {
      const patt = rule.pattern.trim().toLowerCase()
      const { data, error } = await supabase
        .from('client_sender_rules')
        .upsert({ ...rule, pattern: patt }, { onConflict: 'client_id,pattern' })
        .select()
        .single()
      if (error) throw error
      return data as SenderRule
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['sender-rules', v.client_id] }),
  })
}

export function useDeleteSenderRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, client_id }: { id: string; client_id: string }) => {
      const { error } = await supabase.from('client_sender_rules').delete().eq('id', id)
      if (error) throw error
      return { client_id }
    },
    onSuccess: (r) => qc.invalidateQueries({ queryKey: ['sender-rules', r.client_id] }),
  })
}

export function useResolvePendingSender() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pending, action }: { pending: PendingSender; action: 'allow' | 'block' }) => {
      const { error: insErr } = await supabase
        .from('client_sender_rules')
        .upsert(
          { client_id: pending.client_id, pattern: pending.email, mode: action },
          { onConflict: 'client_id,pattern' },
        )
      if (insErr) throw insErr
      const { error: delErr } = await supabase.from('pending_senders').delete().eq('id', pending.id)
      if (delErr) throw delErr
      return pending
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['sender-rules', p.client_id] })
      qc.invalidateQueries({ queryKey: ['pending-senders', p.client_id] })
    },
  })
}

export function useBriefsMatchingSender(clientId: string, pattern: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && !!pattern,
    queryKey: ['briefs-matching', clientId, pattern],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('briefs')
        .select('id, raw_subject, sender_email, received_at, status')
        .eq('client_id', clientId)
      if (error) throw error
      const norm = pattern.trim().toLowerCase()
      const isWildcard = norm.startsWith('*@')
      return (data ?? []).filter((b) => {
        const e = (b.sender_email ?? '').toLowerCase()
        return isWildcard ? e.endsWith(norm.slice(1)) : e === norm
      })
    },
  })
}

export function useApplyRetroAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ brief_ids, action }: { brief_ids: string[]; action: 'archive' | 'delete' }) => {
      if (action === 'archive') {
        const { error } = await supabase
          .from('briefs')
          .update({ status: 'archived' })
          .in('id', brief_ids)
        if (error) throw error
      } else {
        const { error } = await supabase.from('briefs').delete().in('id', brief_ids)
        if (error) throw error
      }
      return brief_ids.length
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefs'] })
      qc.invalidateQueries({ queryKey: ['briefs-matching'] })
    },
  })
}
```

- [ ] **Step 2: Type-check**

```
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSenderRules.ts
git commit -m "feat(sender-rules): TanStack hooks for rules, pending and retro cleanup"
```

---

## Task 8: ClientDetail page + route

**Files:**
- Create: `src/pages/ClientDetail.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/Clients.tsx`

- [ ] **Step 1: Create the page skeleton**

```tsx
// src/pages/ClientDetail.tsx
import { useParams, Link } from 'react-router-dom'
import { useClients } from '@/hooks/useClients'
import { SenderRulesPanel } from '@/components/clients/SenderRulesPanel'
import { Button } from '@/components/ui/button'
import { ChevronLeft } from 'lucide-react'

export function ClientDetail() {
  const { id = '' } = useParams()
  const { data: clients = [] } = useClients()
  const client = clients.find((c) => c.id === id)
  if (!client) return <div className="p-6 text-sm text-muted-foreground">Client not found.</div>
  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/clients"><ChevronLeft className="h-4 w-4" /> All clients</Link>
        </Button>
        <h1 className="mt-2 text-2xl font-semibold">{client.name}</h1>
        <p className="text-sm text-muted-foreground">{client.primary_domain ?? 'No primary domain set'}</p>
      </div>
      <SenderRulesPanel clientId={client.id} primaryDomain={client.primary_domain ?? null} />
    </div>
  )
}
```

- [ ] **Step 2: Register route in `src/App.tsx`**

Add a route entry for `/clients/:id` rendering `<ClientDetail />`. Mirror existing route registration style.

- [ ] **Step 3: Make Client name a link in `src/pages/Clients.tsx`**

In `ClientRow`, replace the name cell `<Input defaultValue={c.name} ... />` with two stacked elements: a `<Link to={`/clients/${c.id}`}>` showing the name, plus a small "Edit name" pencil that pops a dialog (or simply keep the `<Input>` and add a separate `<Link>` icon button beside it for "Open"). Pick the minimum change: add a "Senders" button in the action column (next to the trash icon) that links to `/clients/${c.id}`.

- [ ] **Step 4: Type-check and run dev server**

```
npm run typecheck && npm run dev
```

Expected: typecheck passes, dev server boots on 5174, clicking the new Senders button navigates to the detail page (which will render empty until Task 9 ships the panel).

- [ ] **Step 5: Commit**

```bash
git add src/pages/ClientDetail.tsx src/App.tsx src/pages/Clients.tsx
git commit -m "feat(sender-rules): client detail page route"
```

---

## Task 9: SenderRulesPanel component

**Files:**
- Create: `src/components/clients/SenderRulesPanel.tsx`
- Create: `src/components/clients/RetroCleanupDialog.tsx`

- [ ] **Step 1: Stub `RetroCleanupDialog`**

```tsx
// src/components/clients/RetroCleanupDialog.tsx
import { useBriefsMatchingSender, useApplyRetroAction } from '@/hooks/useSenderRules'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export function RetroCleanupDialog({
  clientId,
  pattern,
  open,
  onClose,
}: {
  clientId: string
  pattern: string
  open: boolean
  onClose: () => void
}) {
  const { data: matches = [], isLoading } = useBriefsMatchingSender(clientId, pattern, open)
  const apply = useApplyRetroAction()

  const run = (action: 'archive' | 'delete') => {
    if (!matches.length) return onClose()
    apply.mutate(
      { brief_ids: matches.map((m) => m.id), action },
      {
        onSuccess: (n) => {
          toast.success(`${action === 'archive' ? 'Archived' : 'Deleted'} ${n} brief${n === 1 ? '' : 's'}`)
          onClose()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clean up matching briefs?</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Searching…</p>
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No existing briefs match <code>{pattern}</code>. Nothing to clean up.</p>
        ) : (
          <>
            <p className="text-sm">{matches.length} brief{matches.length === 1 ? '' : 's'} from <code>{pattern}</code> are in the system.</p>
            <ul className="max-h-60 overflow-auto rounded border text-xs">
              {matches.map((b) => (
                <li key={b.id} className="border-b px-3 py-2 last:border-0">
                  <div className="font-medium">{b.raw_subject ?? '(no subject)'}</div>
                  <div className="text-muted-foreground">{b.sender_email} · {new Date(b.received_at).toLocaleDateString()}</div>
                </li>
              ))}
            </ul>
          </>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Leave</Button>
          <Button variant="secondary" disabled={!matches.length || apply.isPending} onClick={() => run('archive')}>Archive all</Button>
          <Button variant="destructive" disabled={!matches.length || apply.isPending} onClick={() => {
            if (confirm(`Permanently delete ${matches.length} brief(s)? Cascades to messages and scopes.`)) run('delete')
          }}>Delete all</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Build the panel**

```tsx
// src/components/clients/SenderRulesPanel.tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Check, X } from 'lucide-react'
import {
  useSenderRules,
  usePendingSenders,
  useUpsertSenderRule,
  useDeleteSenderRule,
  useResolvePendingSender,
  type SenderRule,
} from '@/hooks/useSenderRules'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { RetroCleanupDialog } from './RetroCleanupDialog'

export function SenderRulesPanel({ clientId, primaryDomain }: { clientId: string; primaryDomain: string | null }) {
  const { data: rules = [], isLoading } = useSenderRules(clientId)
  const { data: pending = [] } = usePendingSenders(clientId)
  const upsert = useUpsertSenderRule()
  const del = useDeleteSenderRule()
  const resolve = useResolvePendingSender()

  const [draftAllow, setDraftAllow] = useState('')
  const [draftBlock, setDraftBlock] = useState('')
  const [retroPattern, setRetroPattern] = useState<string | null>(null)

  const allow = rules.filter((r) => r.mode === 'allow')
  const blocked = rules.filter((r) => r.mode === 'block')

  const add = (pattern: string, mode: 'allow' | 'block') => {
    const v = pattern.trim().toLowerCase()
    if (!v) return
    if (!v.includes('@')) return toast.error('Pattern must be an email or *@domain')
    upsert.mutate(
      { client_id: clientId, pattern: v, mode },
      {
        onSuccess: () => {
          toast.success(`${mode === 'allow' ? 'Allowed' : 'Blocked'} ${v}`)
          if (mode === 'allow') setDraftAllow('')
          else {
            setDraftBlock('')
            setRetroPattern(v) // open retro modal on block
          }
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <div className="space-y-4">
      {primaryDomain && (
        <p className="text-xs text-muted-foreground">
          All senders at <code>@{primaryDomain}</code> are accepted by default. Add allow rules to restrict, or block rules
          to exclude specific addresses. Blocklist beats allowlist.
        </p>
      )}

      <RuleList
        title="Allowed"
        emptyHint="No allow rules — all senders on this domain count as business."
        rules={allow}
        onDelete={(r) => del.mutate({ id: r.id, client_id: clientId })}
        draft={draftAllow}
        setDraft={setDraftAllow}
        onAdd={() => add(draftAllow, 'allow')}
        placeholder="*@thekingscollege.co.za or someone@…"
      />

      <RuleList
        title="Blocked"
        emptyHint="No block rules yet."
        rules={blocked}
        onDelete={(r) => del.mutate({ id: r.id, client_id: clientId })}
        draft={draftBlock}
        setDraft={setDraftBlock}
        onAdd={() => add(draftBlock, 'block')}
        placeholder="gregh@thekingscollege.co.za"
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Pending approval</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? null : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No senders waiting for review.</p>
          ) : (
            <ul className="divide-y">
              {pending.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{p.email}</div>
                    {p.sample_subject && <div className="text-xs text-muted-foreground">{p.sample_subject}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => resolve.mutate({ pending: p, action: 'allow' })}>
                      <Check className="h-3 w-3" /> Allow
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => {
                      resolve.mutate({ pending: p, action: 'block' }, {
                        onSuccess: () => setRetroPattern(p.email),
                      })
                    }}>
                      <X className="h-3 w-3" /> Block
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RetroCleanupDialog
        clientId={clientId}
        pattern={retroPattern ?? ''}
        open={!!retroPattern}
        onClose={() => setRetroPattern(null)}
      />
    </div>
  )
}

function RuleList({
  title,
  emptyHint,
  rules,
  onDelete,
  draft,
  setDraft,
  onAdd,
  placeholder,
}: {
  title: string
  emptyHint: string
  rules: SenderRule[]
  onDelete: (r: SenderRule) => void
  draft: string
  setDraft: (v: string) => void
  onAdd: () => void
  placeholder: string
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="divide-y">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <code>{r.pattern}</code>
                <Button size="icon" variant="ghost" onClick={() => onDelete(r)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} />
          <Button onClick={onAdd}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Type-check + manual smoke test**

```
npm run typecheck
npm run dev
```

In the browser at `http://localhost:5174`:
1. Sign in with `team@convertedclick.co.za` / `cc-calc-2026-temp`.
2. Navigate to Clients → click Senders next to Kings College.
3. Add `gregh@thekingscollege.co.za` to the block list. The retro modal should appear showing the two existing briefs (Past paper for Maths, Extra Afrikaans). Pick **Archive all** and verify both disappear from the Inbox "New" tab after refreshing.
4. Re-open Senders and confirm the block rule is listed.

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/SenderRulesPanel.tsx src/components/clients/RetroCleanupDialog.tsx
git commit -m "feat(sender-rules): senders panel with allow, block, pending, and retro cleanup"
```

---

## Task 10: Inbox UI safety-net filter

**Files:**
- Modify: `src/hooks/useBriefs.ts` (or the equivalent query that feeds the Inbox list)

> The MCP-side enforcement only prevents *new* briefs from being created. Briefs synced before the rule existed still appear in the Inbox unless the user chose Archive/Delete in the retro modal. We add a defensive client-side filter that also hides any brief whose `sender_email` matches an active block rule, even if the user dismissed the retro modal.

- [ ] **Step 1: Locate the Inbox query**

Open `src/hooks/useBriefs.ts` and identify the query that returns briefs grouped by client. Note its `queryKey`.

- [ ] **Step 2: Join in active block rules**

After fetching briefs, also fetch `client_sender_rules` where `mode='block'`. Filter out any brief whose `sender_email` matches any block rule for that brief's `client_id` using `evaluatePattern` (export it from a shared utility — copy the function into `src/lib/senderRules.ts` since the mcp-server module isn't importable from the browser).

- [ ] **Step 3: Create `src/lib/senderRules.ts`**

```ts
export function evaluatePattern(pattern: string, email: string): boolean {
  const p = pattern.trim().toLowerCase()
  const e = email.trim().toLowerCase()
  if (p.startsWith('*@')) return e.endsWith(p.slice(1))
  if (!p.includes('@')) return false
  return p === e
}
```

- [ ] **Step 4: Manual verification**

With the dev server running, add a block rule, do NOT use the retro modal (close it), and confirm the matching brief is no longer visible in the Inbox list.

- [ ] **Step 5: Commit**

```bash
git add src/lib/senderRules.ts src/hooks/useBriefs.ts
git commit -m "feat(sender-rules): hide briefs matching active block rules in Inbox"
```

---

## Task 11: Document the `/intake` skill change

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append a short note**

Add a paragraph under "cc-calculator MCP server setup" noting the new tools:

```
The intake flow now must call `mcp__cc-calculator__evaluate-sender` before
`create-brief`. Decision values: `allow` (proceed), `block` (skip thread,
tag Gmail with CC/Intake/Blocked), `pending` (proceed but the brief will be
flagged for explicit approval in Settings → Clients → [client] → Senders),
`unknown` (sender's domain is not a client domain — current ignore behavior).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note evaluate-sender in intake flow"
```

---

## Self-Review Checklist (executed)

- **Spec coverage:** whitelist ✅ (Allowed list + allow rules), blacklist ✅ (Blocked list), per-client ✅ (FK on `client_id`), domain wildcards ✅ (`*@domain`), pending approval for unknown senders on known domains ✅ (Task 5 + Task 9 Pending section), retro cleanup with prompt per batch ✅ (Task 6 + Task 9 dialog), archive or delete choice ✅ (Task 6).
- **Placeholders:** all SQL, TS, TSX bodies are concrete; no TODOs left.
- **Type consistency:** `SenderRule`, `PendingSender`, decision strings (`allow | block | pending | unknown`) match across MCP tools, hooks, and components. `Rule` (MCP) vs `SenderRule` (frontend) share the same shape — intentional duplication because the frontend type is a Supabase row.
- **Block-wins semantics:** enforced in `decide()` (Task 2), reused everywhere.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-13-sender-rules.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
