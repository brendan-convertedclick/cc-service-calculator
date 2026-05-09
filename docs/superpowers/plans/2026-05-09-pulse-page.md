# Business Pulse Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/pulse` page giving the Ops Manager a 30-second morning read on the business — retainer burn, WIP pipeline, AR aging, client relationship health, pricing health, and revenue trend.

**Architecture:** Each section is a pure presentational component receiving typed data as props. Hooks fetch and transform data independently. A `usePulseAlerts` hook aggregates cross-section alerts. The page wires hooks to components. Pure transformation functions extracted per hook to enable unit testing without Supabase mocks.

**Tech Stack:** React 18, TypeScript, TanStack Query v5, Supabase JS v2, Tailwind + M3 tokens, Vitest + React Testing Library, lucide-react icons.

---

## Parallelisation note

Tasks 1–2 must run first (schema + types). Tasks 3–9 (hooks) are fully independent and can run in parallel. Tasks 10–16 (components) are fully independent and can run in parallel after Task 2. Task 17 (page) must run last.

---

## Task 1: Schema migration

**Files:**
- Apply via `mcp__cc-supabase__apply_migration` (project ref `lpgwxacoqiqpcfpkklib`)

- [ ] **Step 1: Apply migration `pulse_schema`**

```sql
-- Retainer fields on projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS retainer_hours_target     numeric(6,2),
  ADD COLUMN IF NOT EXISTS retainer_monthly_fee_cents int;

-- Manual client touchpoints
CREATE TABLE IF NOT EXISTS client_touchpoints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('meeting', 'call', 'email')),
  notes        text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_touchpoints_client_id
  ON client_touchpoints(client_id);
CREATE INDEX IF NOT EXISTS idx_client_touchpoints_occurred_at
  ON client_touchpoints(occurred_at DESC);

ALTER TABLE client_touchpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_authenticated" ON client_touchpoints
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Verify columns exist**

Run via `mcp__cc-supabase__execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'projects'
  AND column_name IN ('retainer_hours_target','retainer_monthly_fee_cents');
```
Expected: 2 rows returned.

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name = 'client_touchpoints';
```
Expected: 1 row.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(pulse): add retainer fields + client_touchpoints table"
```

---

## Task 2: TypeScript types

**Files:**
- Create: `src/types/pulse.ts`
- Modify: `src/types/db.ts`

- [ ] **Step 1: Add DB types to `src/types/db.ts`**

Find the `projects` Row type and add after `recurrence_mode`:
```ts
retainer_hours_target: number | null
retainer_monthly_fee_cents: number | null
```
Add to projects Insert and Update types as optional (`?`).

Find the clients section and add a new table entry for `client_touchpoints`:
```ts
client_touchpoints: {
  Row: {
    id: string
    client_id: string
    type: 'meeting' | 'call' | 'email'
    notes: string | null
    occurred_at: string
    created_at: string
  }
  Insert: {
    id?: string
    client_id: string
    type: 'meeting' | 'call' | 'email'
    notes?: string | null
    occurred_at?: string
    created_at?: string
  }
  Update: Partial<{
    type: 'meeting' | 'call' | 'email'
    notes: string | null
    occurred_at: string
  }>
}
```

- [ ] **Step 2: Create `src/types/pulse.ts`**

```ts
export interface RetainerBurnRow {
  projectId: string
  clientName: string
  feePerMonthCents: number
  hoursTarget: number
  hoursUsed: number
  burnPct: number
  daysLeftInMonth: number
  effectiveHourlyRateCents: number
  projectedHours: number
  isOverrunRisk: boolean   // pace implies overrun with >5 days left
  isUnderutilised: boolean // <40% with <10 days left
  rag: 'green' | 'amber' | 'red'
}

export interface WipFunnelStage {
  stage: 'Received' | 'Scoping' | 'Quoted' | 'Accepted' | 'Delivered'
  count: number
  itemIds: string[]
}

export interface WipFunnelData {
  stages: WipFunnelStage[]
  conversionRate: number | null   // accepted / received, rolling 30d
  avgCycleDays: number | null
}

export interface ArAgingBand {
  band: '0-30' | '30-60' | '60+'
  totalCents: number
  invoices: Array<{
    id: string
    invoiceNumber: string | null
    clientName: string
    amountCents: number
    daysOverdue: number
  }>
}

export interface ClientHealthRow {
  clientId: string
  clientName: string
  daysSinceContact: number
  lastTouchpointType: 'meeting' | 'call' | 'email' | 'invoice' | null
  revenueTrend: 'up' | 'flat' | 'down'
  rag: 'green' | 'amber' | 'red'
}

export interface PricingHealthData {
  scopeCreepRate: number
  conversionRate: number | null
  byClient: Array<{
    clientId: string
    clientName: string
    scopeCreepRate: number
  }>
}

export interface RevenueTrendRow {
  clientId: string
  clientName: string
  months: Array<{ label: string; cents: number }>  // last 3 months, oldest first
  momChangePct: number | null
  thisMonthCents: number
  trend: 'up' | 'flat' | 'down'
}

export type PulseAlertLevel = 'overdue' | 'watch' | 'flag_am'

export interface PulseAlert {
  id: string
  level: PulseAlertLevel
  message: string
  linkTo: string
}
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/pulse.ts src/types/db.ts
git commit -m "feat(pulse): add pulse types and DB type extensions"
```

---

## Task 3: `usePulseRetainerBurn` hook

**Files:**
- Create: `src/hooks/usePulseRetainerBurn.ts`
- Create: `src/hooks/usePulseRetainerBurn.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/hooks/usePulseRetainerBurn.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeRetainerBurn } from './usePulseRetainerBurn'

const TODAY = new Date('2026-05-09T08:00:00Z')

const project = {
  id: 'p1',
  engagement_type: 'retainer',
  retainer_hours_target: 8,
  retainer_monthly_fee_cents: 1_000_000, // R10,000
  retainer_monthly_fee_cents_from_quote: null,
  client_name: 'Acme',
}

describe('computeRetainerBurn', () => {
  it('returns burn % from hours used vs target', () => {
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 4 }], TODAY)
    expect(rows[0].hoursUsed).toBe(4)
    expect(rows[0].burnPct).toBe(50)
    expect(rows[0].rag).toBe('green')
  })

  it('sets rag amber when burn 70-84%', () => {
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 6 }], TODAY)
    expect(rows[0].rag).toBe('amber')
  })

  it('sets rag red when burn >= 85%', () => {
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 7 }], TODAY)
    expect(rows[0].rag).toBe('red')
  })

  it('flags overrun risk when pace implies overrun with >5 days left', () => {
    // 9 days into 31-day month, 7h used of 8h target → pace = 7/9 * 31 = 24h projected
    const fakeToday = new Date('2026-05-09T08:00:00Z') // day 9
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 7 }], fakeToday)
    expect(rows[0].isOverrunRisk).toBe(true)
  })

  it('excludes non-retainer projects', () => {
    const fixed = { ...project, engagement_type: 'fixed' }
    const rows = computeRetainerBurn([fixed], [{ project_id: 'p1', actual_hours: 4 }], TODAY)
    expect(rows).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/hooks/usePulseRetainerBurn.test.ts --reporter=verbose
```
Expected: FAIL — `computeRetainerBurn` not found.

- [ ] **Step 3: Implement**

Create `src/hooks/usePulseRetainerBurn.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { RetainerBurnRow } from '@/types/pulse'

interface ProjectRow {
  id: string
  engagement_type: string
  retainer_hours_target: number | null
  retainer_monthly_fee_cents: number | null
  client_name: string
}

interface ActualRow {
  project_id: string | null
  actual_hours: number | null
}

export function computeRetainerBurn(
  projects: ProjectRow[],
  actuals: ActualRow[],
  today: Date,
): RetainerBurnRow[] {
  const retainers = projects.filter(p => p.engagement_type === 'retainer' && p.retainer_hours_target)
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const dayOfMonth = today.getDate()
  const daysLeft = daysInMonth - dayOfMonth

  return retainers.map(p => {
    const target = p.retainer_hours_target!
    const fee = p.retainer_monthly_fee_cents ?? 0
    const used = actuals
      .filter(a => a.project_id === p.id)
      .reduce((s, a) => s + (a.actual_hours ?? 0), 0)

    const burnPct = Math.round((used / target) * 100)
    const pace = dayOfMonth > 0 ? (used / dayOfMonth) * daysInMonth : 0
    const projectedHours = Math.round(pace * 10) / 10

    const rag: RetainerBurnRow['rag'] =
      burnPct >= 85 ? 'red' : burnPct >= 70 ? 'amber' : 'green'

    return {
      projectId: p.id,
      clientName: p.client_name,
      feePerMonthCents: fee,
      hoursTarget: target,
      hoursUsed: Math.round(used * 10) / 10,
      burnPct,
      daysLeftInMonth: daysLeft,
      effectiveHourlyRateCents: target > 0 ? Math.round(fee / target) : 0,
      projectedHours,
      isOverrunRisk: projectedHours > target && daysLeft > 5,
      isUnderutilised: burnPct < 40 && daysLeft < 10,
      rag,
    }
  })
}

export function usePulseRetainerBurn(): RetainerBurnRow[] {
  const { data } = useQuery({
    queryKey: ['pulseRetainerBurn'],
    queryFn: async () => {
      const start = new Date()
      start.setDate(1)
      start.setHours(0, 0, 0, 0)

      const [{ data: projects }, { data: actuals }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, engagement_type, retainer_hours_target, retainer_monthly_fee_cents, clients(name)')
          .eq('engagement_type', 'retainer')
          .eq('status', 'active'),
        supabase
          .from('project_actuals_current')
          .select('project_id, actual_hours')
          .gte('recorded_at', start.toISOString()),
      ])

      const mapped = (projects ?? []).map(p => ({
        ...p,
        client_name: (p.clients as { name: string } | null)?.name ?? 'Unknown',
      }))

      return computeRetainerBurn(mapped, actuals ?? [], new Date())
    },
    staleTime: 5 * 60 * 1000,
  })
  return data ?? []
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run src/hooks/usePulseRetainerBurn.test.ts --reporter=verbose
```
Expected: 5 tests pass.

- [ ] **Step 5: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/hooks/usePulseRetainerBurn.ts src/hooks/usePulseRetainerBurn.test.ts
git commit -m "feat(pulse): usePulseRetainerBurn hook"
```

---

## Task 4: `usePulseWipFunnel` hook

**Files:**
- Create: `src/hooks/usePulseWipFunnel.ts`
- Create: `src/hooks/usePulseWipFunnel.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeWipFunnel } from './usePulseWipFunnel'

const briefs = [
  { id: 'b1', am_status: null, quote_id: null },
  { id: 'b2', am_status: 'reviewing', quote_id: null },
  { id: 'b3', am_status: 'approved', quote_id: 'q1' },
]
const quotes = [
  { id: 'q1', status: 'sent' },
]
const projects = [
  { id: 'proj1', status: 'active', scope_status: 'on_track', quote_id: 'q2', completed_at: null },
]
const quotes2 = [{ id: 'q2', status: 'accepted' }]

describe('computeWipFunnel', () => {
  it('puts null am_status briefs in Received', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    expect(stages.find(s => s.stage === 'Received')?.count).toBe(1)
  })

  it('puts reviewing briefs in Scoping', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    expect(stages.find(s => s.stage === 'Scoping')?.count).toBe(1)
  })

  it('puts sent-quoted briefs in Quoted', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    expect(stages.find(s => s.stage === 'Quoted')?.count).toBe(1)
  })

  it('puts accepted-quote active projects in Accepted', () => {
    const { stages } = computeWipFunnel([], [], projects, quotes2)
    expect(stages.find(s => s.stage === 'Accepted')?.count).toBe(1)
  })

  it('computes conversion rate as accepted / (received + scoping)', () => {
    const { conversionRate } = computeWipFunnel(briefs, quotes2, projects, quotes2)
    expect(conversionRate).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/hooks/usePulseWipFunnel.test.ts --reporter=verbose
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { WipFunnelData, WipFunnelStage } from '@/types/pulse'

interface Brief { id: string; am_status: string | null; quote_id: string | null }
interface Quote { id: string; status: string }
interface Project { id: string; status: string; scope_status: string; quote_id: string | null; completed_at: string | null }

export function computeWipFunnel(
  briefs: Brief[],
  quotes: Quote[],
  projects: Project[],
  allQuotes: Quote[],
): WipFunnelData {
  const quoteMap = new Map(allQuotes.map(q => [q.id, q]))

  const received = briefs.filter(b => !b.am_status || b.am_status === 'pending')
  const scoping  = briefs.filter(b => b.am_status === 'reviewing')
  const quoted   = briefs.filter(b => {
    if (!b.quote_id) return false
    const q = quoteMap.get(b.quote_id)
    return q?.status === 'draft' || q?.status === 'sent'
  })
  const accepted = projects.filter(p => {
    if (!p.quote_id) return false
    const q = quoteMap.get(p.quote_id)
    return q?.status === 'accepted' && p.status !== 'completed'
  })
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const delivered = projects.filter(p => p.status === 'completed' && p.completed_at && p.completed_at >= thirtyDaysAgo)

  const stages: WipFunnelStage[] = [
    { stage: 'Received',  count: received.length,  itemIds: received.map(b => b.id) },
    { stage: 'Scoping',   count: scoping.length,   itemIds: scoping.map(b => b.id) },
    { stage: 'Quoted',    count: quoted.length,    itemIds: quoted.map(b => b.id) },
    { stage: 'Accepted',  count: accepted.length,  itemIds: accepted.map(p => p.id) },
    { stage: 'Delivered', count: delivered.length, itemIds: delivered.map(p => p.id) },
  ]

  const totalIn = received.length + scoping.length
  const conversionRate = totalIn > 0 ? Math.round((accepted.length / totalIn) * 100) : null

  return { stages, conversionRate, avgCycleDays: null }
}

export function usePulseWipFunnel(): WipFunnelData {
  const { data } = useQuery({
    queryKey: ['pulseWipFunnel'],
    queryFn: async () => {
      const [{ data: briefs }, { data: quotes }, { data: projects }] = await Promise.all([
        supabase.from('briefs').select('id, am_status, quote_id').not('status', 'eq', 'archived'),
        supabase.from('quotes').select('id, status'),
        supabase.from('projects').select('id, status, scope_status, quote_id, completed_at').neq('status', 'archived'),
      ])
      return computeWipFunnel(briefs ?? [], quotes ?? [], projects ?? [], quotes ?? [])
    },
    staleTime: 5 * 60 * 1000,
  })
  return data ?? { stages: [], conversionRate: null, avgCycleDays: null }
}
```

- [ ] **Step 4: Run tests + TypeScript + commit**

```bash
npx vitest run src/hooks/usePulseWipFunnel.test.ts --reporter=verbose
npx tsc --noEmit
git add src/hooks/usePulseWipFunnel.ts src/hooks/usePulseWipFunnel.test.ts
git commit -m "feat(pulse): usePulseWipFunnel hook"
```

---

## Task 5: `usePulseArAging` hook

**Files:**
- Create: `src/hooks/usePulseArAging.ts`
- Create: `src/hooks/usePulseArAging.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeArAging } from './usePulseArAging'

const TODAY = new Date('2026-05-09')

const invoices = [
  { id: 'i1', xero_invoice_id: 'x1', invoice_number: 'INV-001', xero_contact_name: 'Acme', amount_cents: 1_000_000, due_date: '2026-04-20', status: 'AUTHORISED', paid_at: null }, // 19d overdue
  { id: 'i2', xero_invoice_id: 'x2', invoice_number: 'INV-002', xero_contact_name: 'Beta', amount_cents: 500_000, due_date: '2026-04-01', status: 'AUTHORISED', paid_at: null },  // 38d overdue
  { id: 'i3', xero_invoice_id: 'x3', invoice_number: 'INV-003', xero_contact_name: 'Gama', amount_cents: 200_000, due_date: '2026-05-01', status: 'AUTHORISED', paid_at: null },  // 8d overdue
  { id: 'i4', xero_invoice_id: 'x4', invoice_number: 'INV-004', xero_contact_name: 'Paid', amount_cents: 100_000, due_date: '2026-04-01', status: 'PAID', paid_at: '2026-04-01' }, // paid - excluded
]

describe('computeArAging', () => {
  it('puts 8d overdue invoice in 0-30 band', () => {
    const bands = computeArAging(invoices, TODAY)
    const b = bands.find(b => b.band === '0-30')!
    expect(b.invoices.map(i => i.id)).toContain('i3')
  })

  it('puts 19d overdue in 0-30 band', () => {
    const bands = computeArAging(invoices, TODAY)
    expect(bands.find(b => b.band === '0-30')!.invoices.map(i => i.id)).toContain('i1')
  })

  it('puts 38d overdue in 30-60 band', () => {
    const bands = computeArAging(invoices, TODAY)
    expect(bands.find(b => b.band === '30-60')!.invoices.map(i => i.id)).toContain('i2')
  })

  it('excludes paid invoices', () => {
    const bands = computeArAging(invoices, TODAY)
    const allIds = bands.flatMap(b => b.invoices.map(i => i.id))
    expect(allIds).not.toContain('i4')
  })

  it('totals cents per band', () => {
    const bands = computeArAging(invoices, TODAY)
    const band030 = bands.find(b => b.band === '0-30')!
    expect(band030.totalCents).toBe(1_200_000) // i1 + i3
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/hooks/usePulseArAging.test.ts --reporter=verbose
```

- [ ] **Step 3: Implement**

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ArAgingBand } from '@/types/pulse'

interface Invoice {
  id: string
  invoice_number: string | null
  xero_contact_name: string | null
  amount_cents: number
  due_date: string | null
  status: string
  paid_at: string | null
}

export function computeArAging(invoices: Invoice[], today: Date): ArAgingBand[] {
  const unpaid = invoices.filter(i => i.due_date && !['PAID', 'VOIDED'].includes(i.status) && new Date(i.due_date) < today)

  const bucket = (inv: Invoice): ArAgingBand['band'] => {
    const days = Math.floor((today.getTime() - new Date(inv.due_date!).getTime()) / 86_400_000)
    if (days <= 30) return '0-30'
    if (days <= 60) return '30-60'
    return '60+'
  }

  const bands: ArAgingBand['band'][] = ['0-30', '30-60', '60+']
  return bands.map(band => {
    const matched = unpaid.filter(i => bucket(i) === band)
    return {
      band,
      totalCents: matched.reduce((s, i) => s + i.amount_cents, 0),
      invoices: matched.map(i => ({
        id: i.id,
        invoiceNumber: i.invoice_number,
        clientName: i.xero_contact_name ?? 'Unknown',
        amountCents: i.amount_cents,
        daysOverdue: Math.floor((today.getTime() - new Date(i.due_date!).getTime()) / 86_400_000),
      })),
    }
  })
}

export function usePulseArAging(): ArAgingBand[] | null {
  const { data } = useQuery({
    queryKey: ['pulseArAging'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('xero_invoices')
        .select('id, invoice_number, xero_contact_name, amount_cents, due_date, status, paid_at')
        .not('status', 'in', '("PAID","VOIDED","DRAFT")')
      if (error) throw error
      return computeArAging(data ?? [], new Date())
    },
    staleTime: 10 * 60 * 1000,
  })
  return data ?? null
}
```

- [ ] **Step 4: Run tests + TypeScript + commit**

```bash
npx vitest run src/hooks/usePulseArAging.test.ts --reporter=verbose
npx tsc --noEmit
git add src/hooks/usePulseArAging.ts src/hooks/usePulseArAging.test.ts
git commit -m "feat(pulse): usePulseArAging hook"
```

---

## Task 6: `usePulseClientHealth` hook + log mutation

**Files:**
- Create: `src/hooks/usePulseClientHealth.ts`
- Create: `src/hooks/usePulseClientHealth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeClientHealth } from './usePulseClientHealth'

const TODAY = new Date('2026-05-09')

const clients = [
  { id: 'c1', name: 'Acme' },
  { id: 'c2', name: 'Beta' },
  { id: 'c3', name: 'Gama' },
]
const briefs = [
  { client_id: 'c1', created_at: '2026-05-07T10:00:00Z' }, // 2d ago
  { client_id: 'c2', created_at: '2026-04-21T10:00:00Z' }, // 18d ago
]
const touchpoints = [
  { client_id: 'c3', type: 'meeting', occurred_at: '2026-04-05T10:00:00Z' }, // 34d ago
]
const invoices: { client_id: string; paid_at: string }[] = []

describe('computeClientHealth', () => {
  it('green when last contact < 14 days', () => {
    const rows = computeClientHealth(clients, briefs, touchpoints, invoices, TODAY)
    expect(rows.find(r => r.clientId === 'c1')?.rag).toBe('green')
  })

  it('amber when last contact 14-30 days', () => {
    const rows = computeClientHealth(clients, briefs, touchpoints, invoices, TODAY)
    expect(rows.find(r => r.clientId === 'c2')?.rag).toBe('amber')
  })

  it('red when last contact > 30 days', () => {
    const rows = computeClientHealth(clients, briefs, touchpoints, invoices, TODAY)
    expect(rows.find(r => r.clientId === 'c3')?.rag).toBe('red')
  })

  it('sorts by days since contact descending', () => {
    const rows = computeClientHealth(clients, briefs, touchpoints, invoices, TODAY)
    expect(rows[0].clientId).toBe('c3')
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/hooks/usePulseClientHealth.test.ts --reporter=verbose
```

- [ ] **Step 3: Implement**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ClientHealthRow } from '@/types/pulse'

interface ClientRow { id: string; name: string }
interface BriefRow { client_id: string | null; created_at: string }
interface TouchpointRow { client_id: string; type: 'meeting' | 'call' | 'email'; occurred_at: string }
interface InvoiceRow { client_id: string | null; paid_at: string | null }

export function computeClientHealth(
  clients: ClientRow[],
  briefs: BriefRow[],
  touchpoints: TouchpointRow[],
  invoices: InvoiceRow[],
  today: Date,
): ClientHealthRow[] {
  return clients
    .map(c => {
      const dates: Date[] = []
      const typeMap = new Map<number, ClientHealthRow['lastTouchpointType']>()

      briefs.filter(b => b.client_id === c.id).forEach(b => {
        const d = new Date(b.created_at)
        dates.push(d)
        typeMap.set(d.getTime(), 'email')
      })
      touchpoints.filter(t => t.client_id === c.id).forEach(t => {
        const d = new Date(t.occurred_at)
        dates.push(d)
        typeMap.set(d.getTime(), t.type)
      })
      invoices.filter(i => i.client_id === c.id && i.paid_at).forEach(i => {
        const d = new Date(i.paid_at!)
        dates.push(d)
        typeMap.set(d.getTime(), 'invoice')
      })

      dates.sort((a, b) => b.getTime() - a.getTime())
      const latest = dates[0]
      const daysSince = latest
        ? Math.floor((today.getTime() - latest.getTime()) / 86_400_000)
        : 999

      const rag: ClientHealthRow['rag'] = daysSince > 30 ? 'red' : daysSince > 14 ? 'amber' : 'green'

      return {
        clientId: c.id,
        clientName: c.name,
        daysSinceContact: daysSince,
        lastTouchpointType: latest ? (typeMap.get(latest.getTime()) ?? null) : null,
        revenueTrend: 'flat' as const,  // set by usePulseRevenueTrend, not here
        rag,
      }
    })
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
}

export function usePulseClientHealth(): ClientHealthRow[] {
  const { data } = useQuery({
    queryKey: ['pulseClientHealth'],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const [{ data: clients }, { data: briefs }, { data: touchpoints }, { data: invoices }] =
        await Promise.all([
          supabase.from('clients').select('id, name').eq('status', 'active'),
          supabase.from('briefs').select('client_id, created_at').gte('created_at', thirtyDaysAgo),
          supabase.from('client_touchpoints').select('client_id, type, occurred_at').gte('occurred_at', thirtyDaysAgo),
          supabase.from('xero_invoices').select('client_id, paid_at').not('paid_at', 'is', null).gte('paid_at', thirtyDaysAgo),
        ])
      return computeClientHealth(clients ?? [], briefs ?? [], touchpoints ?? [], invoices ?? [], new Date())
    },
    staleTime: 5 * 60 * 1000,
  })
  return data ?? []
}

export function useLogTouchpoint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      clientId: string
      type: 'meeting' | 'call' | 'email'
      notes?: string
      occurredAt: string
    }) => {
      const { error } = await supabase.from('client_touchpoints').insert({
        client_id: payload.clientId,
        type: payload.type,
        notes: payload.notes ?? null,
        occurred_at: payload.occurredAt,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pulseClientHealth'] }),
  })
}
```

- [ ] **Step 4: Run tests + TypeScript + commit**

```bash
npx vitest run src/hooks/usePulseClientHealth.test.ts --reporter=verbose
npx tsc --noEmit
git add src/hooks/usePulseClientHealth.ts src/hooks/usePulseClientHealth.test.ts
git commit -m "feat(pulse): usePulseClientHealth hook + useLogTouchpoint mutation"
```

---

## Task 7: `usePulsePricingHealth` hook

**Files:**
- Create: `src/hooks/usePulsePricingHealth.ts`
- Create: `src/hooks/usePulsePricingHealth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computePricingHealth } from './usePulsePricingHealth'

const projects = [
  { id: 'p1', client_id: 'c1', client_name: 'Acme', total_actual: 11, total_planned: 10 }, // 10% over → counts
  { id: 'p2', client_id: 'c1', client_name: 'Acme', total_actual: 9,  total_planned: 10 }, // under
  { id: 'p3', client_id: 'c2', client_name: 'Beta', total_actual: 8,  total_planned: 10 }, // under
]

describe('computePricingHealth', () => {
  it('calculates scope creep rate across all projects', () => {
    const { scopeCreepRate } = computePricingHealth(projects)
    expect(scopeCreepRate).toBe(33) // 1 of 3 = 33%
  })

  it('breaks down scope creep by client', () => {
    const { byClient } = computePricingHealth(projects)
    expect(byClient.find(c => c.clientId === 'c1')?.scopeCreepRate).toBe(50) // 1 of 2
    expect(byClient.find(c => c.clientId === 'c2')?.scopeCreepRate).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/hooks/usePulsePricingHealth.test.ts --reporter=verbose
```

- [ ] **Step 3: Implement**

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { PricingHealthData } from '@/types/pulse'

interface ProjectSummary {
  id: string
  client_id: string
  client_name: string
  total_actual: number
  total_planned: number
}

export function computePricingHealth(projects: ProjectSummary[]): PricingHealthData {
  const isCreep = (p: ProjectSummary) => p.total_planned > 0 && p.total_actual > p.total_planned * 1.10

  const scopeCreepRate = projects.length > 0
    ? Math.round((projects.filter(isCreep).length / projects.length) * 100)
    : 0

  const byClientMap = new Map<string, { name: string; total: number; over: number }>()
  projects.forEach(p => {
    const existing = byClientMap.get(p.client_id) ?? { name: p.client_name, total: 0, over: 0 }
    byClientMap.set(p.client_id, {
      ...existing,
      total: existing.total + 1,
      over: existing.over + (isCreep(p) ? 1 : 0),
    })
  })

  return {
    scopeCreepRate,
    conversionRate: null,
    byClient: Array.from(byClientMap.entries()).map(([clientId, v]) => ({
      clientId,
      clientName: v.name,
      scopeCreepRate: v.total > 0 ? Math.round((v.over / v.total) * 100) : 0,
    })),
  }
}

export function usePulsePricingHealth(): PricingHealthData | null {
  const { data } = useQuery({
    queryKey: ['pulsePricingHealth'],
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const { data: projects } = await supabase
        .from('projects')
        .select('id, client_id, clients(name), project_actuals_current(actual_hours, planned_hours)')
        .eq('status', 'completed')
        .gte('completed_at', since)

      const mapped: ProjectSummary[] = (projects ?? []).map(p => {
        const actuals = (p.project_actuals_current as Array<{ actual_hours: number | null; planned_hours: number | null }>) ?? []
        return {
          id: p.id,
          client_id: p.client_id ?? '',
          client_name: (p.clients as { name: string } | null)?.name ?? 'Unknown',
          total_actual: actuals.reduce((s, a) => s + (a.actual_hours ?? 0), 0),
          total_planned: actuals.reduce((s, a) => s + (a.planned_hours ?? 0), 0),
        }
      })

      return computePricingHealth(mapped)
    },
    staleTime: 15 * 60 * 1000,
  })
  return data ?? null
}
```

- [ ] **Step 4: Run tests + TypeScript + commit**

```bash
npx vitest run src/hooks/usePulsePricingHealth.test.ts --reporter=verbose
npx tsc --noEmit
git add src/hooks/usePulsePricingHealth.ts src/hooks/usePulsePricingHealth.test.ts
git commit -m "feat(pulse): usePulsePricingHealth hook"
```

---

## Task 8: `usePulseRevenueTrend` hook

**Files:**
- Create: `src/hooks/usePulseRevenueTrend.ts`
- Create: `src/hooks/usePulseRevenueTrend.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeRevenueTrend } from './usePulseRevenueTrend'

const clients = [{ id: 'c1', name: 'Acme' }]
const invoices = [
  { client_id: 'c1', amount_cents: 1_000_000, paid_at: '2026-03-15T00:00:00Z' },
  { client_id: 'c1', amount_cents: 1_000_000, paid_at: '2026-04-15T00:00:00Z' },
  { client_id: 'c1', amount_cents: 1_200_000, paid_at: '2026-05-01T00:00:00Z' },
]
const TODAY = new Date('2026-05-09')

describe('computeRevenueTrend', () => {
  it('returns 3 months of data', () => {
    const rows = computeRevenueTrend(clients, invoices, TODAY)
    expect(rows[0].months).toHaveLength(3)
  })

  it('marks up trend when current month > previous by 5%+', () => {
    const rows = computeRevenueTrend(clients, invoices, TODAY)
    expect(rows[0].trend).toBe('up')
    expect(rows[0].momChangePct).toBe(20)
  })

  it('marks flat trend when change < 5%', () => {
    const flat = [
      { client_id: 'c1', amount_cents: 1_000_000, paid_at: '2026-04-15T00:00:00Z' },
      { client_id: 'c1', amount_cents: 1_000_000, paid_at: '2026-05-01T00:00:00Z' },
    ]
    const rows = computeRevenueTrend(clients, flat, TODAY)
    expect(rows[0].trend).toBe('flat')
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/hooks/usePulseRevenueTrend.test.ts --reporter=verbose
```

- [ ] **Step 3: Implement**

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { RevenueTrendRow } from '@/types/pulse'

interface ClientRow { id: string; name: string }
interface InvoiceRow { client_id: string | null; amount_cents: number; paid_at: string | null }

export function computeRevenueTrend(clients: ClientRow[], invoices: InvoiceRow[], today: Date): RevenueTrendRow[] {
  const months: { year: number; month: number; label: string }[] = []
  for (let i = 2; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    months.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }),
    })
  }

  return clients.map(c => {
    const clientInvoices = invoices.filter(i => i.client_id === c.id && i.paid_at)
    const monthTotals = months.map(m => {
      const total = clientInvoices
        .filter(i => {
          const d = new Date(i.paid_at!)
          return d.getFullYear() === m.year && d.getMonth() === m.month
        })
        .reduce((s, i) => s + i.amount_cents, 0)
      return { label: m.label, cents: total }
    })

    const thisMonth = monthTotals[2].cents
    const lastMonth = monthTotals[1].cents
    const momChangePct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null
    const trend: RevenueTrendRow['trend'] =
      momChangePct === null ? 'flat' : momChangePct >= 5 ? 'up' : momChangePct <= -5 ? 'down' : 'flat'

    return {
      clientId: c.id,
      clientName: c.name,
      months: monthTotals,
      momChangePct,
      thisMonthCents: thisMonth,
      trend,
    }
  }).sort((a, b) => b.thisMonthCents - a.thisMonthCents)
}

export function usePulseRevenueTrend(): RevenueTrendRow[] | null {
  const { data } = useQuery({
    queryKey: ['pulseRevenueTrend'],
    queryFn: async () => {
      const since = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString()
      const [{ data: clients }, { data: invoices }] = await Promise.all([
        supabase.from('clients').select('id, name').eq('status', 'active'),
        supabase.from('xero_invoices').select('client_id, amount_cents, paid_at').eq('status', 'PAID').gte('paid_at', since),
      ])
      if (!clients) return null
      return computeRevenueTrend(clients, invoices ?? [], new Date())
    },
    staleTime: 15 * 60 * 1000,
  })
  return data ?? null
}
```

- [ ] **Step 4: Run tests + TypeScript + commit**

```bash
npx vitest run src/hooks/usePulseRevenueTrend.test.ts --reporter=verbose
npx tsc --noEmit
git add src/hooks/usePulseRevenueTrend.ts src/hooks/usePulseRevenueTrend.test.ts
git commit -m "feat(pulse): usePulseRevenueTrend hook"
```

---

## Task 9: `usePulseAlerts` hook

**Files:**
- Create: `src/hooks/usePulseAlerts.ts`
- Create: `src/hooks/usePulseAlerts.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeAlerts } from './usePulseAlerts'
import type { RetainerBurnRow, ArAgingBand, ClientHealthRow } from '@/types/pulse'

const retainer: RetainerBurnRow = {
  projectId: 'p1', clientName: 'Acme', feePerMonthCents: 1_000_000,
  hoursTarget: 8, hoursUsed: 7.5, burnPct: 94, daysLeftInMonth: 9,
  effectiveHourlyRateCents: 125_000, projectedHours: 12,
  isOverrunRisk: true, isUnderutilised: false, rag: 'red',
}
const arBand: ArAgingBand = {
  band: '60+',
  totalCents: 500_000,
  invoices: [{ id: 'i1', invoiceNumber: 'INV-001', clientName: 'Beta', amountCents: 500_000, daysOverdue: 65 }],
}
const quietClient: ClientHealthRow = {
  clientId: 'c1', clientName: 'Gama', daysSinceContact: 25,
  lastTouchpointType: 'email', revenueTrend: 'flat', rag: 'amber',
}

describe('computeAlerts', () => {
  it('creates WATCH alert for retainer overrun risk', () => {
    const alerts = computeAlerts([retainer], [], [], [])
    expect(alerts.some(a => a.level === 'watch' && a.message.includes('Acme'))).toBe(true)
  })

  it('creates OVERDUE alert for 60+ day invoice', () => {
    const alerts = computeAlerts([], [arBand], [], [])
    expect(alerts.some(a => a.level === 'overdue' && a.message.includes('Beta'))).toBe(true)
  })

  it('creates FLAG_AM alert for client silent 21+ days', () => {
    const alerts = computeAlerts([], [], [quietClient], [])
    expect(alerts.some(a => a.level === 'flag_am' && a.message.includes('Gama'))).toBe(true)
  })

  it('sorts overdue before watch before flag_am', () => {
    const alerts = computeAlerts([retainer], [arBand], [quietClient], [])
    expect(alerts[0].level).toBe('overdue')
    expect(alerts[1].level).toBe('watch')
    expect(alerts[2].level).toBe('flag_am')
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/hooks/usePulseAlerts.test.ts --reporter=verbose
```

- [ ] **Step 3: Implement**

```ts
import type { ArAgingBand, ClientHealthRow, PulseAlert, RetainerBurnRow } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const fmt = (cents: number) => ZAR.format(cents / 100)

export function computeAlerts(
  retainerRows: RetainerBurnRow[],
  arBands: ArAgingBand[],
  clientHealth: ClientHealthRow[],
  _reserved: unknown[],
): PulseAlert[] {
  const alerts: PulseAlert[] = []

  retainerRows
    .filter(r => r.isOverrunRisk || r.burnPct >= 85)
    .forEach(r => alerts.push({
      id: `retainer-${r.projectId}`,
      level: 'watch',
      message: `${r.clientName} retainer — ${r.burnPct}% of hours burned with ${r.daysLeftInMonth} days left`,
      linkTo: `/projects`,
    }))

  arBands
    .flatMap(b => b.invoices.filter(i => i.daysOverdue > 30))
    .forEach(i => alerts.push({
      id: `ar-${i.id}`,
      level: 'overdue',
      message: `${i.clientName} — Invoice ${i.invoiceNumber ?? fmt(i.amountCents)} overdue ${i.daysOverdue} days`,
      linkTo: `/reconciliation`,
    }))

  clientHealth
    .filter(c => c.daysSinceContact >= 21)
    .forEach(c => alerts.push({
      id: `client-${c.clientId}`,
      level: c.daysSinceContact >= 30 ? 'overdue' : 'flag_am',
      message: `${c.clientName} — No email or meeting in ${c.daysSinceContact} days. Account manager should follow up.`,
      linkTo: `/clients`,
    }))

  const order: Record<string, number> = { overdue: 0, watch: 1, flag_am: 2 }
  return alerts.sort((a, b) => order[a.level] - order[b.level])
}
```

Note: `usePulseAlerts` is a pure computation — no `useQuery` needed. Call it in `PulseView` by passing data from other hooks.

- [ ] **Step 4: Run tests + TypeScript + commit**

```bash
npx vitest run src/hooks/usePulseAlerts.test.ts --reporter=verbose
npx tsc --noEmit
git add src/hooks/usePulseAlerts.ts src/hooks/usePulseAlerts.test.ts
git commit -m "feat(pulse): computeAlerts aggregator"
```

---

## Task 10: `AlertsStrip` component

**Files:**
- Create: `src/components/pulse/AlertsStrip.tsx`
- Create: `src/components/pulse/AlertsStrip.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { AlertsStrip } from './AlertsStrip'
import { MemoryRouter } from 'react-router-dom'

const alerts = [
  { id: 'a1', level: 'overdue' as const, message: 'Acme overdue 34 days', linkTo: '/reconciliation' },
]

describe('AlertsStrip', () => {
  it('shows all-clear when no alerts', () => {
    render(<MemoryRouter><AlertsStrip alerts={[]} /></MemoryRouter>)
    expect(screen.getByText(/all clear/i)).toBeInTheDocument()
  })

  it('shows alert count when alerts present', () => {
    render(<MemoryRouter><AlertsStrip alerts={alerts} /></MemoryRouter>)
    expect(screen.getByText(/1 item/i)).toBeInTheDocument()
  })

  it('renders alert message', () => {
    render(<MemoryRouter><AlertsStrip alerts={alerts} /></MemoryRouter>)
    expect(screen.getByText(/Acme overdue 34 days/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/components/pulse/AlertsStrip.test.tsx --reporter=verbose
```

- [ ] **Step 3: Implement**

Create `src/components/pulse/AlertsStrip.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { PulseAlert } from '@/types/pulse'

const levelStyles: Record<PulseAlert['level'], { strip: string; badge: string; badgeText: string; label: string }> = {
  overdue: { strip: 'border-l-4 border-m-error', badge: 'bg-m-error text-m-on-error', badgeText: 'OVERDUE', label: '' },
  watch:   { strip: 'border-l-4 border-amber-400', badge: 'bg-amber-400 text-white', badgeText: 'WATCH', label: '' },
  flag_am: { strip: 'border-l-4 border-m-tertiary', badge: 'bg-m-tertiary text-m-on-tertiary', badgeText: 'FLAG AM', label: '' },
}

export function AlertsStrip({ alerts }: { alerts: PulseAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-3 text-body-small font-semibold text-green-800">
        ✓ All clear — no alerts today
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-m-error-container bg-m-error-container overflow-hidden">
      <div className="px-4 py-2 bg-m-error">
        <span className="text-label-small font-bold text-m-on-error uppercase tracking-wide">
          ⚠ {alerts.length} item{alerts.length !== 1 ? 's' : ''} need{alerts.length === 1 ? 's' : ''} your attention
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {alerts.map(alert => {
          const s = levelStyles[alert.level]
          return (
            <div key={alert.id} className={cn('flex items-center gap-3 rounded bg-m-surface px-3 py-2', s.strip)}>
              <p className="flex-1 text-body-small text-m-on-surface">{alert.message}</p>
              <Link to={alert.linkTo} className={cn('shrink-0 rounded-full px-3 py-0.5 text-label-small font-bold', s.badge)}>
                {s.badgeText}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests + TypeScript + commit**

```bash
npx vitest run src/components/pulse/AlertsStrip.test.tsx --reporter=verbose
npx tsc --noEmit
git add src/components/pulse/
git commit -m "feat(pulse): AlertsStrip component"
```

---

## Task 11: `RetainerBurnSection` component

**Files:**
- Create: `src/components/pulse/RetainerBurnSection.tsx`
- Create: `src/components/pulse/RetainerBurnSection.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RetainerBurnSection } from './RetainerBurnSection'
import type { RetainerBurnRow } from '@/types/pulse'

const row: RetainerBurnRow = {
  projectId: 'p1', clientName: 'Acme',
  feePerMonthCents: 1_000_000, hoursTarget: 8, hoursUsed: 5.5,
  burnPct: 69, daysLeftInMonth: 18,
  effectiveHourlyRateCents: 125_000, projectedHours: 7,
  isOverrunRisk: false, isUnderutilised: false, rag: 'green',
}

describe('RetainerBurnSection', () => {
  it('renders client name', () => {
    render(<RetainerBurnSection rows={[row]} />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })

  it('renders burn percentage', () => {
    render(<RetainerBurnSection rows={[row]} />)
    expect(screen.getByText(/69%/)).toBeInTheDocument()
  })

  it('shows empty state when no retainers', () => {
    render(<RetainerBurnSection rows={[]} />)
    expect(screen.getByText(/no retainer clients/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail + implement + run to pass**

```bash
npx vitest run src/components/pulse/RetainerBurnSection.test.tsx --reporter=verbose
```

Create `src/components/pulse/RetainerBurnSection.tsx`:

```tsx
import { cn } from '@/lib/utils'
import type { RetainerBurnRow } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const fmt = (cents: number) => ZAR.format(cents / 100)

const barColor: Record<RetainerBurnRow['rag'], string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-m-error',
}

export function RetainerBurnSection({ rows }: { rows: RetainerBurnRow[] }) {
  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        Retainer Burn — {new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}
      </h2>
      {rows.length === 0 ? (
        <p className="text-body-small text-m-on-surface-variant">No retainer clients configured.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(r => (
            <div key={r.projectId}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-body-small font-semibold text-m-on-surface">
                  {r.clientName}{' '}
                  <span className="text-label-small font-normal text-m-on-surface-variant">
                    {fmt(r.feePerMonthCents)}/mo · {r.hoursTarget}h target
                  </span>
                </span>
                <span className={cn('text-label-small font-semibold', r.rag === 'green' ? 'text-m-on-surface-variant' : r.rag === 'amber' ? 'text-amber-700' : 'text-m-error')}>
                  {r.hoursUsed}h / {r.hoursTarget}h
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-m-surface-container-high">
                <div className={cn('h-full rounded-full transition-all', barColor[r.rag])} style={{ width: `${Math.min(r.burnPct, 100)}%` }} />
              </div>
              <p className={cn('mt-1 text-label-small', r.isOverrunRisk ? 'text-amber-700 font-medium' : r.isUnderutilised ? 'text-m-on-surface-variant' : 'text-m-on-surface-variant')}>
                {r.burnPct}% · {r.daysLeftInMonth} days left
                {r.isOverrunRisk && ' · at risk of overrun'}
                {r.isUnderutilised && ' · under-utilised'}
                {' · '}{fmt(r.effectiveHourlyRateCents)}/h effective rate
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

```bash
npx vitest run src/components/pulse/RetainerBurnSection.test.tsx --reporter=verbose
npx tsc --noEmit
git add src/components/pulse/
git commit -m "feat(pulse): RetainerBurnSection component"
```

---

## Task 12: `WipFunnelSection` component

**Files:**
- Create: `src/components/pulse/WipFunnelSection.tsx`
- Create: `src/components/pulse/WipFunnelSection.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { WipFunnelSection } from './WipFunnelSection'
import type { WipFunnelData } from '@/types/pulse'

const data: WipFunnelData = {
  stages: [
    { stage: 'Received', count: 7, itemIds: [] },
    { stage: 'Scoping',  count: 4, itemIds: [] },
    { stage: 'Quoted',   count: 3, itemIds: [] },
    { stage: 'Accepted', count: 2, itemIds: [] },
    { stage: 'Delivered',count: 5, itemIds: [] },
  ],
  conversionRate: 78,
  avgCycleDays: 4.2,
}

describe('WipFunnelSection', () => {
  it('renders all 5 stage labels', () => {
    render(<WipFunnelSection data={data} />)
    expect(screen.getByText('Received')).toBeInTheDocument()
    expect(screen.getByText('Delivered')).toBeInTheDocument()
  })

  it('renders conversion rate', () => {
    render(<WipFunnelSection data={data} />)
    expect(screen.getByText(/78%/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail + implement + run to pass**

```bash
npx vitest run src/components/pulse/WipFunnelSection.test.tsx --reporter=verbose
```

Create `src/components/pulse/WipFunnelSection.tsx`:

```tsx
import type { WipFunnelData } from '@/types/pulse'

const stageColors = ['bg-indigo-500', 'bg-violet-500', 'bg-violet-400', 'bg-violet-300', 'bg-green-500']

export function WipFunnelSection({ data }: { data: WipFunnelData }) {
  const max = Math.max(...data.stages.map(s => s.count), 1)

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        WIP Pipeline
      </h2>
      <div className="flex items-end gap-2 h-16">
        {data.stages.map((s, i) => (
          <div key={s.stage} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-label-small font-bold text-m-on-surface">{s.count}</span>
            <div
              className={`w-full rounded-t ${stageColors[i]}`}
              style={{ height: `${Math.max((s.count / max) * 48, 4)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {data.stages.map(s => (
          <div key={s.stage} className="flex-1 text-center text-label-small text-m-on-surface-variant truncate">
            {s.stage}
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-m-surface-container px-3 py-2 text-body-small text-m-on-surface-variant">
        Conversion:{' '}
        <strong className="text-m-on-surface">
          {data.conversionRate !== null ? `${data.conversionRate}%` : '—'}
        </strong>{' '}
        brief→accepted
        {data.avgCycleDays !== null && (
          <> · Avg cycle: <strong className="text-m-on-surface">{data.avgCycleDays}d</strong></>
        )}
      </div>
    </section>
  )
}
```

```bash
npx vitest run src/components/pulse/WipFunnelSection.test.tsx --reporter=verbose
npx tsc --noEmit
git add src/components/pulse/
git commit -m "feat(pulse): WipFunnelSection component"
```

---

## Task 13: `ArAgingSection` component

**Files:**
- Create: `src/components/pulse/ArAgingSection.tsx`
- Create: `src/components/pulse/ArAgingSection.test.tsx`

- [ ] **Step 1: Write failing test + implement + run to pass**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ArAgingSection } from './ArAgingSection'
import type { ArAgingBand } from '@/types/pulse'

const bands: ArAgingBand[] = [
  { band: '0-30',  totalCents: 2_800_000, invoices: [] },
  { band: '30-60', totalCents: 1_400_000, invoices: [] },
  { band: '60+',   totalCents: 800_000,  invoices: [{ id: 'i1', invoiceNumber: 'INV-001', clientName: 'Acme', amountCents: 800_000, daysOverdue: 65 }] },
]

describe('ArAgingSection', () => {
  it('renders all 3 bands', () => {
    render(<ArAgingSection bands={bands} />)
    expect(screen.getByText('0 – 30 days')).toBeInTheDocument()
    expect(screen.getByText('60+ days')).toBeInTheDocument()
  })

  it('shows not-connected state when bands is null', () => {
    render(<ArAgingSection bands={null} />)
    expect(screen.getByText(/connect xero/i)).toBeInTheDocument()
  })
})
```

Create `src/components/pulse/ArAgingSection.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { ArAgingBand } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const fmt = (cents: number) => ZAR.format(cents / 100)

const bandMeta = {
  '0-30':  { label: '0 – 30 days', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', valueText: 'text-green-800' },
  '30-60': { label: '30 – 60 days', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', valueText: 'text-amber-800' },
  '60+':   { label: '60+ days', bg: 'bg-m-error-container', border: 'border-m-error-container', text: 'text-m-error', valueText: 'text-m-error' },
}

export function ArAgingSection({ bands }: { bands: ArAgingBand[] | null }) {
  if (!bands) {
    return (
      <section>
        <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">AR Aging</h2>
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container p-4 text-body-small text-m-on-surface-variant">
          <Link to="/settings?connect=xero" className="underline">Connect Xero</Link> to see AR aging.
        </div>
      </section>
    )
  }

  const total = bands.reduce((s, b) => s + b.totalCents, 0)

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">AR Aging</h2>
      <div className="grid grid-cols-3 gap-3 mb-3">
        {bands.map(b => {
          const m = bandMeta[b.band]
          return (
            <div key={b.band} className={`rounded-lg border p-3 text-center ${m.bg} ${m.border}`}>
              <div className={`text-title-large font-bold ${m.valueText}`}>{fmt(b.totalCents)}</div>
              <div className={`mt-1 text-label-small ${m.text}`}>{m.label}</div>
              <div className="mt-0.5 text-label-small text-m-on-surface-variant">{b.invoices.length} invoice{b.invoices.length !== 1 ? 's' : ''}</div>
            </div>
          )
        })}
      </div>
      <p className="text-body-small text-m-on-surface-variant">
        Total outstanding: <strong className="text-m-on-surface">{fmt(total)}</strong>
      </p>
    </section>
  )
}
```

```bash
npx vitest run src/components/pulse/ArAgingSection.test.tsx --reporter=verbose
npx tsc --noEmit
git add src/components/pulse/
git commit -m "feat(pulse): ArAgingSection component"
```

---

## Task 14: `LogTouchpointModal` + `ClientHealthSection` components

**Files:**
- Create: `src/components/pulse/LogTouchpointModal.tsx`
- Create: `src/components/pulse/ClientHealthSection.tsx`
- Create: `src/components/pulse/ClientHealthSection.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ClientHealthSection } from './ClientHealthSection'
import type { ClientHealthRow } from '@/types/pulse'

const rows: ClientHealthRow[] = [
  { clientId: 'c1', clientName: 'Acme', daysSinceContact: 2,  lastTouchpointType: 'email',   revenueTrend: 'up',   rag: 'green' },
  { clientId: 'c2', clientName: 'Beta', daysSinceContact: 25, lastTouchpointType: 'meeting', revenueTrend: 'flat', rag: 'amber' },
  { clientId: 'c3', clientName: 'Zara', daysSinceContact: 35, lastTouchpointType: null,      revenueTrend: 'down', rag: 'red' },
]

describe('ClientHealthSection', () => {
  it('renders all client names', () => {
    render(<ClientHealthSection rows={rows} onLogTouchpoint={vi.fn()} />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Zara')).toBeInTheDocument()
  })

  it('shows days since contact', () => {
    render(<ClientHealthSection rows={rows} onLogTouchpoint={vi.fn()} />)
    expect(screen.getByText(/35 days/i)).toBeInTheDocument()
  })

  it('calls onLogTouchpoint when Log button clicked', () => {
    const spy = vi.fn()
    render(<ClientHealthSection rows={rows} onLogTouchpoint={spy} />)
    fireEvent.click(screen.getAllByRole('button', { name: /log/i })[0])
    expect(spy).toHaveBeenCalledWith('c1')
  })
})
```

- [ ] **Step 2: Run to verify fail + implement + run to pass**

```bash
npx vitest run src/components/pulse/ClientHealthSection.test.tsx --reporter=verbose
```

Create `src/components/pulse/LogTouchpointModal.tsx`:

```tsx
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'

interface Props {
  clientId: string
  clientName: string
  open: boolean
  onClose: () => void
  onSubmit: (payload: { clientId: string; type: 'meeting' | 'call' | 'email'; notes?: string; occurredAt: string }) => void
  isPending: boolean
}

export function LogTouchpointModal({ clientId, clientName, open, onClose, onSubmit, isPending }: Props) {
  const [type, setType] = useState<'meeting' | 'call' | 'email'>('meeting')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log touchpoint — {clientName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={v => setType(v as typeof type)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={isPending}
            onClick={() => onSubmit({ clientId, type, notes: notes || undefined, occurredAt: new Date(date).toISOString() })}
          >
            {isPending ? 'Saving…' : 'Log touchpoint'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

Create `src/components/pulse/ClientHealthSection.tsx`:

```tsx
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LogTouchpointModal } from './LogTouchpointModal'
import { useLogTouchpoint } from '@/hooks/usePulseClientHealth'
import type { ClientHealthRow } from '@/types/pulse'

const ragDot: Record<ClientHealthRow['rag'], string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-m-error',
}
const trendLabel: Record<ClientHealthRow['revenueTrend'], { text: string; cls: string }> = {
  up:   { text: '↑', cls: 'text-green-600 font-bold' },
  flat: { text: '→', cls: 'text-m-on-surface-variant' },
  down: { text: '↓', cls: 'text-m-error font-bold' },
}

interface Props {
  rows: ClientHealthRow[]
  onLogTouchpoint: (clientId: string) => void
}

export function ClientHealthSection({ rows, onLogTouchpoint }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        Client Relationship Health
      </h2>
      <div className="flex flex-col gap-2">
        {rows.map(r => (
          <div key={r.clientId} className="flex items-center gap-3 rounded-lg bg-m-surface-container px-3 py-2.5">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', ragDot[r.rag])} />
            <span className="flex-1 text-body-small font-medium text-m-on-surface">{r.clientName}</span>
            <span className={cn('text-label-small', r.daysSinceContact > 21 ? 'text-amber-700 font-medium' : 'text-m-on-surface-variant')}>
              {r.lastTouchpointType ?? 'no contact'} {r.daysSinceContact < 999 ? `${r.daysSinceContact} days ago` : ''}
            </span>
            <span className={trendLabel[r.revenueTrend].cls}>{trendLabel[r.revenueTrend].text}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-label-small" onClick={() => onLogTouchpoint(r.clientId)}>
              Log
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-label-small text-m-on-surface-variant">
        Auto-tracked: inbound emails + paid invoices · Manual: log meetings and calls above
      </p>
    </section>
  )
}

// Connected version used in PulseView
export function ClientHealthSectionConnected({ rows }: { rows: ClientHealthRow[] }) {
  const [activeClientId, setActiveClientId] = useState<string | null>(null)
  const logTouchpoint = useLogTouchpoint()
  const activeClient = rows.find(r => r.clientId === activeClientId)

  return (
    <>
      <ClientHealthSection rows={rows} onLogTouchpoint={setActiveClientId} />
      {activeClient && (
        <LogTouchpointModal
          clientId={activeClient.clientId}
          clientName={activeClient.clientName}
          open={!!activeClientId}
          onClose={() => setActiveClientId(null)}
          onSubmit={payload => logTouchpoint.mutate(payload, { onSuccess: () => setActiveClientId(null) })}
          isPending={logTouchpoint.isPending}
        />
      )}
    </>
  )
}
```

```bash
npx vitest run src/components/pulse/ClientHealthSection.test.tsx --reporter=verbose
npx tsc --noEmit
git add src/components/pulse/
git commit -m "feat(pulse): ClientHealthSection + LogTouchpointModal"
```

---

## Task 15: `PricingHealthSection` component

**Files:**
- Create: `src/components/pulse/PricingHealthSection.tsx`
- Create: `src/components/pulse/PricingHealthSection.test.tsx`

- [ ] **Write failing test + implement + run to pass**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PricingHealthSection } from './PricingHealthSection'

describe('PricingHealthSection', () => {
  it('renders scope creep rate', () => {
    render(<PricingHealthSection data={{ scopeCreepRate: 22, conversionRate: 78, byClient: [] }} />)
    expect(screen.getByText(/22%/)).toBeInTheDocument()
  })
  it('renders conversion rate', () => {
    render(<PricingHealthSection data={{ scopeCreepRate: 22, conversionRate: 78, byClient: [] }} />)
    expect(screen.getByText(/78%/)).toBeInTheDocument()
  })
  it('shows no-data state', () => {
    render(<PricingHealthSection data={null} />)
    expect(screen.getByText(/no completed projects/i)).toBeInTheDocument()
  })
})
```

Create `src/components/pulse/PricingHealthSection.tsx`:

```tsx
import type { PricingHealthData } from '@/types/pulse'

export function PricingHealthSection({ data }: { data: PricingHealthData | null }) {
  if (!data) {
    return (
      <section>
        <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">Pricing Health</h2>
        <p className="text-body-small text-m-on-surface-variant">No completed projects in the last 90 days.</p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">Pricing Health</h2>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-m-surface-container p-3">
          <div className="text-display-small font-bold text-m-on-surface">{data.scopeCreepRate}%</div>
          <div className="mt-1 text-label-small font-semibold text-m-on-surface-variant">Scope creep rate</div>
          <div className="mt-0.5 text-label-small text-m-on-surface-variant">projects &gt;10% over quote</div>
        </div>
        <div className="rounded-lg bg-m-surface-container p-3">
          <div className="text-display-small font-bold text-m-on-surface">
            {data.conversionRate !== null ? `${data.conversionRate}%` : '—'}
          </div>
          <div className="mt-1 text-label-small font-semibold text-m-on-surface-variant">Brief conversion</div>
          <div className="mt-0.5 text-label-small text-m-on-surface-variant">brief → accepted quote</div>
        </div>
      </div>
      {data.byClient.length > 0 && (
        <div>
          <p className="mb-2 text-label-small font-semibold text-m-on-surface-variant">Scope creep by client (90 days)</p>
          <div className="flex flex-col gap-2">
            {data.byClient.map(c => (
              <div key={c.clientId} className="flex items-center gap-3">
                <span className="w-24 truncate text-body-small text-m-on-surface">{c.clientName}</span>
                <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-m-surface-container-high">
                  <div
                    className={c.scopeCreepRate > 20 ? 'h-full rounded-full bg-m-error' : 'h-full rounded-full bg-green-500'}
                    style={{ width: `${Math.min(c.scopeCreepRate, 100)}%` }}
                  />
                </div>
                <span className={`w-8 text-right text-label-small font-semibold ${c.scopeCreepRate > 20 ? 'text-m-error' : 'text-green-700'}`}>
                  {c.scopeCreepRate}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
```

```bash
npx vitest run src/components/pulse/PricingHealthSection.test.tsx --reporter=verbose
npx tsc --noEmit
git add src/components/pulse/
git commit -m "feat(pulse): PricingHealthSection component"
```

---

## Task 16: `RevenueTrendSection` component

**Files:**
- Create: `src/components/pulse/RevenueTrendSection.tsx`
- Create: `src/components/pulse/RevenueTrendSection.test.tsx`

- [ ] **Write failing test + implement + run to pass**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RevenueTrendSection } from './RevenueTrendSection'

const rows = [
  { clientId: 'c1', clientName: 'Acme', months: [{ label: 'Mar 26', cents: 1_000_000 }, { label: 'Apr 26', cents: 1_000_000 }, { label: 'May 26', cents: 1_200_000 }], momChangePct: 20, thisMonthCents: 1_200_000, trend: 'up' as const },
]

describe('RevenueTrendSection', () => {
  it('renders client name', () => {
    render(<RevenueTrendSection rows={rows} />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })
  it('renders MoM change', () => {
    render(<RevenueTrendSection rows={rows} />)
    expect(screen.getByText(/\+20%/)).toBeInTheDocument()
  })
  it('shows not-connected state when null', () => {
    render(<RevenueTrendSection rows={null} />)
    expect(screen.getByText(/connect xero/i)).toBeInTheDocument()
  })
})
```

Create `src/components/pulse/RevenueTrendSection.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { RevenueTrendRow } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const fmt = (cents: number) => ZAR.format(cents / 100)

export function RevenueTrendSection({ rows }: { rows: RevenueTrendRow[] | null }) {
  if (!rows) {
    return (
      <section>
        <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">Revenue Trend</h2>
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container p-4 text-body-small text-m-on-surface-variant">
          <Link to="/settings?connect=xero" className="underline">Connect Xero</Link> to see revenue trends.
        </div>
      </section>
    )
  }

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">Revenue Trend — Client MoM</h2>
      <div className="flex flex-col gap-2">
        {rows.map(r => {
          const maxCents = Math.max(...r.months.map(m => m.cents), 1)
          return (
            <div key={r.clientId} className="flex items-center gap-3 rounded-lg bg-m-surface-container px-3 py-2.5">
              <span className="w-28 truncate text-body-small font-medium text-m-on-surface">{r.clientName}</span>
              <div className="flex items-end gap-0.5 h-5">
                {r.months.map((m, i) => (
                  <div
                    key={m.label}
                    className={i === 2 ? 'w-2 rounded-sm bg-indigo-500' : 'w-2 rounded-sm bg-indigo-300'}
                    style={{ height: `${Math.max((m.cents / maxCents) * 20, 2)}px` }}
                    title={`${m.label}: ${fmt(m.cents)}`}
                  />
                ))}
              </div>
              <span className={`text-label-small font-bold ${r.trend === 'up' ? 'text-green-600' : r.trend === 'down' ? 'text-m-error' : 'text-m-on-surface-variant'}`}>
                {r.momChangePct !== null ? `${r.momChangePct >= 0 ? '+' : ''}${r.momChangePct}%` : '→'}
              </span>
              <span className="ml-auto text-body-small text-m-on-surface-variant">{fmt(r.thisMonthCents)}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

```bash
npx vitest run src/components/pulse/RevenueTrendSection.test.tsx --reporter=verbose
npx tsc --noEmit
git add src/components/pulse/
git commit -m "feat(pulse): RevenueTrendSection component"
```

---

## Task 17: `PulseView` page + route + nav

**Files:**
- Create: `src/pages/PulseView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/nav/navItems.ts`

- [ ] **Step 1: Create `src/pages/PulseView.tsx`**

```tsx
import { useAvgDftCycleTime } from '@/hooks/useAvgDftCycleTime'
import { usePulseRetainerBurn } from '@/hooks/usePulseRetainerBurn'
import { usePulseWipFunnel } from '@/hooks/usePulseWipFunnel'
import { usePulseArAging } from '@/hooks/usePulseArAging'
import { usePulseClientHealth } from '@/hooks/usePulseClientHealth'
import { usePulsePricingHealth } from '@/hooks/usePulsePricingHealth'
import { usePulseRevenueTrend } from '@/hooks/usePulseRevenueTrend'
import { computeAlerts } from '@/hooks/usePulseAlerts'
import { AlertsStrip } from '@/components/pulse/AlertsStrip'
import { RetainerBurnSection } from '@/components/pulse/RetainerBurnSection'
import { WipFunnelSection } from '@/components/pulse/WipFunnelSection'
import { ArAgingSection } from '@/components/pulse/ArAgingSection'
import { ClientHealthSectionConnected } from '@/components/pulse/ClientHealthSection'
import { PricingHealthSection } from '@/components/pulse/PricingHealthSection'
import { RevenueTrendSection } from '@/components/pulse/RevenueTrendSection'

export function PulseView() {
  const retainerBurn  = usePulseRetainerBurn()
  const wipFunnel     = usePulseWipFunnel()
  const arAging       = usePulseArAging()
  const clientHealth  = usePulseClientHealth()
  const pricingHealth = usePulsePricingHealth()
  const revenueTrend  = usePulseRevenueTrend()
  const dftCycle      = useAvgDftCycleTime()

  const wipWithCycle = { ...wipFunnel, avgCycleDays: dftCycle?.avgDays ?? null }
  const alerts = computeAlerts(retainerBurn, arAging ?? [], clientHealth, [])

  return (
    <div className="flex flex-col gap-6 overflow-auto p-6">
      {/* Header */}
      <div>
        <h1 className="text-headline-medium text-m-on-surface">Business Pulse</h1>
        <p className="text-body-small text-m-on-surface-variant">
          {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Alerts */}
      <AlertsStrip alerts={alerts} />

      {/* Two-column grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <RetainerBurnSection rows={retainerBurn} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <WipFunnelSection data={wipWithCycle} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <ArAgingSection bands={arAging} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <ClientHealthSectionConnected rows={clientHealth} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <PricingHealthSection data={pricingHealth} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <RevenueTrendSection rows={revenueTrend} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add route to `src/App.tsx`**

Add lazy import (after the ReconciliationView import):
```tsx
const PulseView = lazy(() =>
  import('@/pages/PulseView').then((m) => ({ default: m.PulseView })),
)
```

Add route (inside `<AppShell>` routes, after the reconciliation route):
```tsx
<Route path="pulse" element={<PulseView />} />
```

- [ ] **Step 3: Add nav item to `src/components/nav/navItems.ts`**

Add `Zap` to the lucide-react import:
```ts
import { ..., Zap } from 'lucide-react'
```

Add to `navItems` array, before the Reconciliation entry:
```ts
{ to: '/pulse', label: 'Pulse', icon: Zap, end: false },
```

- [ ] **Step 4: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/pages/PulseView.tsx src/App.tsx src/components/nav/navItems.ts
git commit -m "feat(pulse): PulseView page, route /pulse, nav item"
```

---

## Task 18: Retainer fields on ProjectDetail form

**Files:**
- Modify: `src/pages/ProjectDetail.tsx`

- [ ] **Step 1: Add retainer fields**

In `src/pages/ProjectDetail.tsx`, find where `due_date` was added (Task 1 of Phase 1). Add two new fields immediately below it, shown only when `project.engagement_type === 'retainer'`:

```tsx
{project.engagement_type === 'retainer' && (
  <>
    <div className="rounded-lg border border-m-outline-variant bg-m-surface p-4">
      <p className="mb-2 text-label-small font-semibold text-m-on-surface-variant uppercase tracking-wide">
        Retainer — Monthly target
      </p>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-label-small text-m-on-surface-variant">Hours target / month</label>
          <Input
            type="number"
            min={0}
            step={0.5}
            defaultValue={project.retainer_hours_target ?? ''}
            onBlur={e => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val)) {
                updateProject.mutate({ id: project.id, retainer_hours_target: val })
              }
            }}
          />
        </div>
        <div className="flex-1">
          <label className="text-label-small text-m-on-surface-variant">Monthly fee (ZAR)</label>
          <Input
            type="number"
            min={0}
            step={100}
            defaultValue={project.retainer_monthly_fee_cents != null ? project.retainer_monthly_fee_cents / 100 : ''}
            onBlur={e => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val)) {
                updateProject.mutate({ id: project.id, retainer_monthly_fee_cents: Math.round(val * 100) })
              }
            }}
          />
        </div>
      </div>
    </div>
  </>
)}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/pages/ProjectDetail.tsx
git commit -m "feat(pulse): retainer hours target + monthly fee fields on ProjectDetail"
```

---

## Self-review checklist

- [x] Schema migration covers both `retainer_hours_target` + `client_touchpoints` table
- [x] All 7 pulse types defined in `src/types/pulse.ts`
- [x] All hook pure functions unit-tested before implementation
- [x] `computeAlerts` tested for all 3 alert types and sort order
- [x] All components tested for render + empty/null states
- [x] `ArAgingSection` and `RevenueTrendSection` both handle `null` (Xero not connected)
- [x] `ClientHealthSectionConnected` is the page-level version with modal wired; `ClientHealthSection` is the pure testable version
- [x] `PulseView` wires `useAvgDftCycleTime` into `WipFunnelSection.avgCycleDays`
- [x] Route `/pulse` added, nav item `Zap` icon added before Reconciliation
- [x] Retainer fields on `ProjectDetail` gated by `engagement_type === 'retainer'`
