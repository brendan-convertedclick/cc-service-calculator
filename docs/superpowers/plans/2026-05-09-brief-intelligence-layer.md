# Brief Intelligence Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `brief_intelligence` table + MCP tool + Scope page redesign + intake skill restructure so every inbound brief is automatically unpacked into a department-level work breakdown, estimate, and AM approval gate before a scope is created.

**Architecture:** Three sequential layers — (1) DB migration + MCP tool (backend, enables everything), (2) App UI on the Scope page (reads from brief_intelligence), (3) Intake skill restructure (writes to brief_intelligence via MCP). Tasks 1–5 must complete before Tasks 6–8. Tasks 6–8 and 9–14 can run in parallel once Tasks 1–5 are done.

**Tech Stack:** Supabase Postgres (migration), TypeScript + Zod (MCP server at `mcp-server/`), React 18 + TanStack Query + shadcn/ui + Tailwind (app at `src/`), Markdown skill files (`~/.claude/skills/intake/`).

**Spec:** `docs/superpowers/specs/2026-05-09-brief-intelligence-layer-design.md`

---

## Part A — Backend: Database + MCP

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0031_brief_intelligence.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0031_brief_intelligence.sql
create table if not exists brief_intelligence (
  id                      uuid primary key default gen_random_uuid(),
  brief_id                uuid not null unique references briefs(id) on delete cascade,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Stage 2: interpretation
  summary                 text,
  business_objective      text,
  client_context_snap     jsonb,

  -- Stage 2: requirements mapped to services
  -- [{text, interpretation, mapped_service_ids: uuid[], confidence: 'low'|'med'|'high'}]
  requirements            jsonb,

  -- Stage 3: work breakdown per department
  -- [{department_id, department_name, deliverables, tasks,
  --   human_hours_low, human_hours_mid, human_hours_high,
  --   ai_hours, suggested_assignee_id}]
  work_breakdown          jsonb,

  -- Stage 4: rolled-up estimation
  total_human_hours_low   numeric(6,2),
  total_human_hours_mid   numeric(6,2),
  total_human_hours_high  numeric(6,2),
  total_ai_hours          numeric(6,2),
  estimated_price_cents   integer,
  confidence_level        text check (confidence_level in ('low','medium','high')),
  -- [{question: string, context: string}]
  open_questions          jsonb,

  -- Stage 4: capacity signal
  inferred_start_date     date,
  inferred_deadline       date,
  priority_tier           text check (priority_tier in ('urgent','standard','flexible')),

  -- AM approval gate
  am_status               text not null default 'pending'
                          check (am_status in ('pending','approved','rejected')),
  am_reviewed_at          timestamptz,
  am_reviewed_by          uuid references team_members(id),
  am_notes                text,

  -- Generation metadata
  pipeline_version        text,
  services_snapshot       jsonb,
  -- [{stage, completed_at, duration_ms, confidence, notes}]
  audit_trail             jsonb not null default '[]'
);

create index brief_intelligence_brief_id_idx on brief_intelligence(brief_id);
create index brief_intelligence_am_status_idx  on brief_intelligence(am_status);

alter table brief_intelligence enable row level security;
create policy "authenticated full access" on brief_intelligence
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__cc-supabase__apply_migration` with the SQL above. Verify success — check that the tool returns no error.

- [ ] **Step 3: Regenerate TypeScript types**

Use `mcp__cc-supabase__generate_typescript_types` and overwrite `src/types/db.ts`. Confirm `brief_intelligence` appears in the generated file under `Tables`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0031_brief_intelligence.sql src/types/db.ts
git commit -m "feat(db): add brief_intelligence table"
```

---

### Task 2: MCP tool — `set-brief-intelligence`

**Files:**
- Create: `mcp-server/src/tools/set-brief-intelligence.ts`
- Create: `mcp-server/src/tools/set-brief-intelligence.test.ts`

Pattern reference: `mcp-server/src/tools/set-brief-intent.ts` — same export shape (`schema` + `handler`).

- [ ] **Step 1: Write the failing test**

```typescript
// mcp-server/src/tools/set-brief-intelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase before importing the handler
vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn(),
  },
}))

import { handler, schema } from './set-brief-intelligence.js'
import { supabase } from '../supabase.js'

const mockFrom = supabase.from as ReturnType<typeof vi.fn>

describe('set-brief-intelligence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts a brief_intelligence record and returns id + am_status', async () => {
    const fakeRow = {
      id: 'intel-uuid',
      brief_id: 'brief-uuid',
      am_status: 'pending',
    }
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid', summary: 'Test summary' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.brief_id).toBe('brief-uuid')
    expect(parsed.am_status).toBe('pending')
    expect(result.isError).toBeUndefined()
  })

  it('returns error when upsert fails', async () => {
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'FK violation' } }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.error).toBe('FK violation')
    expect(result.isError).toBe(true)
  })

  it('schema rejects missing brief_id', () => {
    expect(() => schema.parse({})).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mcp-server && npx vitest run src/tools/set-brief-intelligence.test.ts
```
Expected: FAIL — `Cannot find module './set-brief-intelligence.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// mcp-server/src/tools/set-brief-intelligence.ts
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  brief_id:             z.string().uuid().describe('UUID of the brief this intelligence belongs to'),
  summary:              z.string().optional().describe('2–3 sentence synthesis in client language'),
  business_objective:   z.string().optional().describe('What success looks like for the client'),
  client_context_snap:  z.unknown().optional().describe('Snapshot of wiki client context at generation time'),
  requirements:         z.unknown().optional().describe('Array of {text, interpretation, mapped_service_ids, confidence}'),
  work_breakdown:       z.unknown().optional().describe('Array of department breakdowns with tasks and hours'),
  total_human_hours_low:  z.number().optional(),
  total_human_hours_mid:  z.number().optional(),
  total_human_hours_high: z.number().optional(),
  total_ai_hours:         z.number().optional(),
  estimated_price_cents:  z.number().int().optional(),
  confidence_level:     z.enum(['low','medium','high']).optional(),
  open_questions:       z.unknown().optional().describe('Array of {question, context}'),
  inferred_start_date:  z.string().optional().describe('ISO date string'),
  inferred_deadline:    z.string().optional().describe('ISO date string'),
  priority_tier:        z.enum(['urgent','standard','flexible']).optional(),
  pipeline_version:     z.string().optional(),
  services_snapshot:    z.unknown().optional(),
  audit_trail_entry:    z.object({
    stage:        z.string(),
    completed_at: z.string(),
    duration_ms:  z.number().optional(),
    confidence:   z.number().optional(),
    notes:        z.string().optional(),
  }).optional().describe('Single audit trail entry to append — appended, not replaced'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { audit_trail_entry, ...fields } = input

    // Fetch existing audit_trail if we need to append
    let existingAuditTrail: unknown[] = []
    if (audit_trail_entry) {
      const { data: existing } = await supabase
        .from('brief_intelligence')
        .select('audit_trail')
        .eq('brief_id', input.brief_id)
        .maybeSingle()
      existingAuditTrail = (existing?.audit_trail as unknown[]) ?? []
    }

    const upsertPayload = {
      ...fields,
      updated_at: new Date().toISOString(),
      ...(audit_trail_entry
        ? { audit_trail: [...existingAuditTrail, audit_trail_entry] }
        : {}),
    }

    const { data, error } = await supabase
      .from('brief_intelligence')
      .upsert(upsertPayload, { onConflict: 'brief_id' })
      .select('id, brief_id, am_status')
      .single()

    if (error || !data) throw new Error(error?.message ?? 'Upsert failed')

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: data.id,
        brief_id: data.brief_id,
        am_status: data.am_status,
      }) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd mcp-server && npx vitest run src/tools/set-brief-intelligence.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools/set-brief-intelligence.ts mcp-server/src/tools/set-brief-intelligence.test.ts
git commit -m "feat(mcp): add set-brief-intelligence tool"
```

---

### Task 3: MCP tool — `get-brief-intelligence`

**Files:**
- Create: `mcp-server/src/tools/get-brief-intelligence.ts`
- Create: `mcp-server/src/tools/get-brief-intelligence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// mcp-server/src/tools/get-brief-intelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  },
}))

import { handler, schema } from './get-brief-intelligence.js'
import { supabase } from '../supabase.js'

const mockFrom = supabase.from as ReturnType<typeof vi.fn>

describe('get-brief-intelligence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the intelligence record for a brief', async () => {
    const fakeRow = { id: 'intel-uuid', brief_id: 'brief-uuid', am_status: 'pending', summary: 'Test' }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.am_status).toBe('pending')
    expect(parsed.summary).toBe('Test')
  })

  it('returns null when no record exists', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mcp-server && npx vitest run src/tools/get-brief-intelligence.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// mcp-server/src/tools/get-brief-intelligence.ts
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  brief_id: z.string().uuid().describe('UUID of the brief'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('brief_intelligence')
      .select('*')
      .eq('brief_id', input.brief_id)
      .maybeSingle()

    if (error) throw new Error(error.message)

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd mcp-server && npx vitest run src/tools/get-brief-intelligence.test.ts
```
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools/get-brief-intelligence.ts mcp-server/src/tools/get-brief-intelligence.test.ts
git commit -m "feat(mcp): add get-brief-intelligence tool"
```

---

### Task 4: Register both tools in MCP server

**Files:**
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: Add imports and registrations**

In `mcp-server/src/index.ts`, add after the last existing import:

```typescript
import * as setBriefIntelligence from './tools/set-brief-intelligence.js'
import * as getBriefIntelligence from './tools/get-brief-intelligence.js'
```

Then add after the last `server.tool(...)` call (before the transport/connect section):

```typescript
server.tool(
  'set-brief-intelligence',
  'Upsert a brief_intelligence record for a brief. Stages call this after completing their output. Appends audit_trail_entry if provided. Returns { id, brief_id, am_status }.',
  rawShape(setBriefIntelligence.schema),
  h(setBriefIntelligence.handler),
)

server.tool(
  'get-brief-intelligence',
  'Get the brief_intelligence record for a brief by brief_id. Returns the full record or null if not yet generated.',
  rawShape(getBriefIntelligence.schema),
  h(getBriefIntelligence.handler),
)
```

- [ ] **Step 2: Verify the server starts**

```bash
cd mcp-server && npm run dev
```
Expected: Server starts with no TypeScript errors. Kill with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): register set/get-brief-intelligence tools"
```

---

## Part B — App UI: Scope Page Redesign

### Task 5: `useBriefIntelligence` hook

**Files:**
- Create: `src/hooks/useBriefIntelligence.ts`

Pattern reference: `src/hooks/useBriefs.ts` — same TanStack Query + Supabase pattern.

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useBriefIntelligence.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type BriefIntelligence =
  Database["public"]["Tables"]["brief_intelligence"]["Row"];

const KEY = (briefId: string | undefined) =>
  ["brief-intelligence", briefId] as const;

export function useBriefIntelligence(briefId: string | undefined) {
  return useQuery({
    queryKey: KEY(briefId),
    queryFn: async (): Promise<BriefIntelligence | null> => {
      if (!briefId) return null;
      const { data, error } = await supabase
        .from("brief_intelligence")
        .select("*")
        .eq("brief_id", briefId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!briefId,
    // Poll every 5s while pending so the UI updates when intake finishes
    refetchInterval: (query) =>
      query.state.data?.am_status === "pending" ? 5000 : false,
  });
}

export function useApproveBriefIntelligence(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("brief_intelligence")
        .update({
          am_status: "approved",
          am_reviewed_at: new Date().toISOString(),
        })
        .eq("brief_id", briefId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(briefId) });
    },
  });
}

export function useRejectBriefIntelligence(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ notes }: { notes: string }) => {
      const { data, error } = await supabase
        .from("brief_intelligence")
        .update({
          am_status: "rejected",
          am_notes: notes,
          am_reviewed_at: new Date().toISOString(),
        })
        .eq("brief_id", briefId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(briefId) });
    },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/brendangunn/Github/cc-service-calculator && npx tsc --noEmit
```
Expected: 0 errors (if `brief_intelligence` is in `src/types/db.ts` from Task 1 Step 3).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBriefIntelligence.ts
git commit -m "feat(hooks): add useBriefIntelligence with polling + approve/reject mutations"
```

---

### Task 6: `BriefIntelligenceView` component

**Files:**
- Create: `src/components/BriefIntelligenceView.tsx`

This component renders the intelligence record. It is display-only — approve/reject actions are in the parent (Scope page). It handles loading, generating, and populated states.

- [ ] **Step 1: Write the component**

```tsx
// src/components/BriefIntelligenceView.tsx
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Database } from "@/types/db";

type BriefIntelligence =
  Database["public"]["Tables"]["brief_intelligence"]["Row"];

// JSONB shapes — cast from unknown after validating not null
type Requirement = {
  text: string;
  interpretation: string;
  mapped_service_ids: string[];
  confidence: "low" | "med" | "high";
};

type DeptBreakdown = {
  department_id: string;
  department_name: string;
  deliverables: { name: string; format?: string; quantity?: number; platform?: string }[];
  tasks: { title: string; description?: string; is_ai_eligible?: boolean }[];
  human_hours_low: number;
  human_hours_mid: number;
  human_hours_high: number;
  ai_hours: number;
};

type OpenQuestion = { question: string; context: string };

const CONFIDENCE_COLOURS: Record<string, string> = {
  high:   "bg-green-100 text-green-800 border-green-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low:    "bg-red-100 text-red-800 border-red-200",
};

interface Props {
  intelligence: BriefIntelligence | null;
  isLoading: boolean;
}

export function BriefIntelligenceView({ intelligence, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (!intelligence) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-body-medium text-m-on-surface-variant">
        Analysing brief… This usually takes under 30 seconds.
      </div>
    );
  }

  const requirements = (intelligence.requirements as Requirement[] | null) ?? [];
  const workBreakdown = (intelligence.work_breakdown as DeptBreakdown[] | null) ?? [];
  const openQuestions = (intelligence.open_questions as OpenQuestion[] | null) ?? [];

  const confidenceClass =
    CONFIDENCE_COLOURS[intelligence.confidence_level ?? "low"] ??
    CONFIDENCE_COLOURS.low;

  return (
    <div className="space-y-4">
      {/* Summary */}
      {(intelligence.summary || intelligence.business_objective) && (
        <div className="rounded-lg border bg-m-surface-container p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
              Brief Summary
            </span>
            {intelligence.confidence_level && (
              <Badge
                variant="outline"
                className={`text-label-small ${confidenceClass}`}
              >
                {intelligence.confidence_level} confidence
              </Badge>
            )}
          </div>
          {intelligence.summary && (
            <p className="text-body-medium">{intelligence.summary}</p>
          )}
          {intelligence.business_objective && (
            <p className="text-body-small text-m-on-surface-variant">
              <span className="font-medium">Objective:</span>{" "}
              {intelligence.business_objective}
            </p>
          )}
        </div>
      )}

      {/* Requirements */}
      {requirements.length > 0 && (
        <div className="rounded-lg border p-4 space-y-3">
          <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
            Requirements
          </span>
          <ul className="space-y-3">
            {requirements.map((req, i) => (
              <li key={i} className="space-y-1">
                <p className="text-body-medium">
                  <span className="text-m-on-surface-variant mr-1">●</span>
                  &ldquo;{req.text}&rdquo;
                </p>
                {req.interpretation && (
                  <p className="ml-4 text-body-small text-m-on-surface-variant">
                    {req.interpretation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Work Breakdown */}
      {workBreakdown.length > 0 && (
        <div className="rounded-lg border p-4 space-y-4">
          <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
            Work Breakdown
          </span>
          {workBreakdown.map((dept, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-title-small font-medium">
                  {dept.department_name}
                </span>
                <span className="text-body-small text-m-on-surface-variant">
                  {dept.human_hours_low}–{dept.human_hours_high} hrs human
                  {dept.ai_hours > 0 && (
                    <span className="ml-2 text-m-primary">
                      · {dept.ai_hours} hrs AI
                    </span>
                  )}
                </span>
              </div>
              {dept.deliverables?.length > 0 && (
                <ul className="ml-3 space-y-1">
                  {dept.deliverables.map((d, j) => (
                    <li key={j} className="text-body-small text-m-on-surface-variant">
                      ∟ {d.name}
                      {d.format && (
                        <span className="ml-1 text-m-outline">({d.format})</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Estimate */}
      {(intelligence.total_human_hours_mid != null ||
        intelligence.estimated_price_cents != null) && (
        <div className="rounded-lg border bg-m-surface-container-high p-4 grid grid-cols-2 gap-4">
          {intelligence.total_human_hours_mid != null && (
            <div>
              <div className="text-label-small text-m-on-surface-variant">Human hours</div>
              <div className="text-title-medium">
                {intelligence.total_human_hours_low}–
                {intelligence.total_human_hours_high} hrs
              </div>
              {(intelligence.total_ai_hours ?? 0) > 0 && (
                <div className="text-body-small text-m-primary">
                  + {intelligence.total_ai_hours} hrs AI
                </div>
              )}
            </div>
          )}
          {intelligence.estimated_price_cents != null && (
            <div>
              <div className="text-label-small text-m-on-surface-variant">Estimated price</div>
              <div className="text-title-medium">
                {new Intl.NumberFormat("en-ZA", {
                  style: "currency",
                  currency: "ZAR",
                }).format(intelligence.estimated_price_cents / 100)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Open Questions */}
      {openQuestions.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 space-y-2">
          <span className="text-label-small font-medium text-yellow-800 uppercase tracking-wide">
            Open Questions
          </span>
          <ul className="space-y-1">
            {openQuestions.map((q, i) => (
              <li key={i} className="text-body-small text-yellow-900">
                ⚠ {q.question}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/BriefIntelligenceView.tsx
git commit -m "feat(ui): add BriefIntelligenceView component"
```

---

### Task 7: Scope page redesign

**Files:**
- Modify: `src/pages/Scope.tsx` (full replacement)

The existing Scope.tsx is a prose editor with an AI draft button. It is **replaced** with the intelligence view + AM approval gate. The ScopeEditor is preserved in the approved state (AM can still edit the scope after approving).

- [ ] **Step 1: Write the redesigned Scope page**

Replace the entire contents of `src/pages/Scope.tsx`:

```tsx
// src/pages/Scope.tsx
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ScopeEditor } from "@/components/ScopeEditor";
import { BriefIntelligenceView } from "@/components/BriefIntelligenceView";
import { useBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { useScope, useUpsertScope } from "@/hooks/useScopes";
import {
  useBriefIntelligence,
  useApproveBriefIntelligence,
  useRejectBriefIntelligence,
} from "@/hooks/useBriefIntelligence";
import { useCurrentUserId } from "@/context/AuthContext";
import { isMostlyAi } from "@/lib/scope-overlap";

const INTENT_LABEL: Record<string, string> = {
  new_brief:       "New brief",
  project_thread:  "Project thread",
  retainer_thread: "Retainer",
  general_query:   "General query",
  quick_response:  "Quick response",
};

type ScopeValues = {
  enhanced_prose:   string;
  in_scope_md:      string;
  out_of_scope_md:  string;
  open_questions_md: string;
};

const EMPTY: ScopeValues = {
  enhanced_prose:   "",
  in_scope_md:      "",
  out_of_scope_md:  "",
  open_questions_md: "",
};

function concat(v: ScopeValues) {
  return `${v.enhanced_prose}\n${v.in_scope_md}\n${v.out_of_scope_md}\n${v.open_questions_md}`;
}

export function Scope() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const userId = useCurrentUserId();

  const { data: brief } = useBrief(id);
  const { data: intelligence, isLoading: intelLoading } = useBriefIntelligence(id);
  const { data: scope } = useScope(id);
  const updateBrief = useUpdateBrief();
  const upsertScope = useUpsertScope();
  const approve = useApproveBriefIntelligence(id ?? "");
  const reject = useRejectBriefIntelligence(id ?? "");

  const [rejectNotes, setRejectNotes] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [scopeValues, setScopeValues] = useState<ScopeValues>(EMPTY);
  const [lastAiDraft, setLastAiDraft] = useState("");

  if (!brief) return <div className="p-6 text-body-medium">Loading…</div>;

  const amStatus = intelligence?.am_status ?? "pending";
  const isApproved = amStatus === "approved";
  const isRejected = amStatus === "rejected";

  const handleApprove = async () => {
    try {
      await approve.mutateAsync();
      toast.success("Brief approved — you can now build the scope");
    } catch {
      toast.error("Failed to approve");
    }
  };

  const handleReject = async () => {
    if (!rejectNotes.trim()) {
      toast.error("Add notes so the AI knows what to fix");
      return;
    }
    try {
      await reject.mutateAsync({ notes: rejectNotes });
      setRejectNotes("");
      setShowRejectInput(false);
      toast.success("Rejected — intake will regenerate on next run");
    } catch {
      toast.error("Failed to reject");
    }
  };

  const lockScope = async () => {
    if (!id) return;
    await upsertScope.mutateAsync({
      brief_id: id,
      ...scopeValues,
      ai_drafted: lastAiDraft ? isMostlyAi(concat(scopeValues), lastAiDraft) : false,
      locked_at: new Date().toISOString(),
      locked_by: userId,
    });
    await updateBrief.mutateAsync({ id, patch: { status: "scoped" } });
    navigate(`/briefs/${id}/builder`);
  };

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/inbox"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-title-large truncate">{brief.raw_subject ?? "(no subject)"}</h1>
          <div className="flex items-center gap-2 mt-1">
            {brief.intent_type && (
              <Badge className="text-label-small">
                {INTENT_LABEL[brief.intent_type] ?? brief.intent_type}
              </Badge>
            )}
            {brief.sender_email && (
              <span className="text-body-small text-m-on-surface-variant">
                {brief.sender_email}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Intelligence view — always visible */}
      <BriefIntelligenceView
        intelligence={intelligence ?? null}
        isLoading={intelLoading}
      />

      {/* AM Review actions — only when pending */}
      {!isApproved && !isRejected && intelligence && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {showRejectInput ? (
              <div className="space-y-2">
                <Textarea
                  placeholder="What needs to change? The AI will use these notes when it regenerates…"
                  rows={3}
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRejectInput(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleReject}
                    disabled={reject.isPending}
                  >
                    {reject.isPending ? "Rejecting…" : "Reject & regenerate"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRejectInput(true)}
                >
                  Reject — needs changes
                </Button>
                <Button
                  onClick={handleApprove}
                  disabled={approve.isPending}
                >
                  {approve.isPending ? "Approving…" : "Approve → build scope"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rejected state */}
      {isRejected && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-body-small text-red-800">
          Rejected. Intake will regenerate the intelligence on the next run.
          {intelligence?.am_notes && (
            <p className="mt-1 font-medium">Notes: {intelligence.am_notes}</p>
          )}
        </div>
      )}

      {/* Scope editor — only after approval */}
      {isApproved && (
        <div className="space-y-4 pt-2">
          <h2 className="text-title-medium">Scope</h2>
          <ScopeEditor
            value={scopeValues}
            onChange={(v) => setScopeValues({ ...scopeValues, ...v })}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                upsertScope.mutateAsync({ brief_id: id!, ...scopeValues, ai_drafted: false })
                  .then(() => toast.success("Saved"))
              }
            >
              Save draft
            </Button>
            <Button onClick={lockScope}>Lock scope</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Start dev server and manually verify the Scope page**

```bash
npm run dev
```

Navigate to `http://localhost:5174`. Open a brief in the Inbox, click "Scope →". Verify:
- The page loads without errors
- If `brief_intelligence` row exists: the summary, requirements, work breakdown, estimate, and open questions render
- If no row: the "Analysing brief…" placeholder shows
- The Approve button is visible when `am_status === 'pending'`
- Clicking Approve updates the status and shows the scope editor

- [ ] **Step 4: Commit**

```bash
git add src/pages/Scope.tsx
git commit -m "feat(ui): redesign Scope page as Brief Intelligence View with AM approval gate"
```

---

## Part C — Intake Skill Restructure

> These tasks write markdown skill files only. No TypeScript. Can be done in parallel with Part B once Part A is complete.

### Task 8: Restructure skill directory

**Files:**
- Create: `~/.claude/skills/intake/stages/` directory
- Move (copy + delete): `references/intent-classification.md` → `stages/classify-intent.md`
- Update: `~/.claude/skills/intake/SKILL.md`

- [ ] **Step 1: Create the stages directory and promote existing stage files**

```bash
mkdir -p ~/.claude/skills/intake/stages
cp ~/.claude/skills/intake/references/intent-classification.md \
   ~/.claude/skills/intake/stages/classify-intent.md
```

Add this header block at the top of `~/.claude/skills/intake/stages/classify-intent.md` (before existing content):

```markdown
# Stage 1 — Classify Intent

**Reads:** `brief.raw_body`, `brief.raw_subject`, `brief.sender_email`
**Writes:** `intent_type` on `briefs` table via `mcp__cc-calculator__set-brief-intent`
**Tools:** `mcp__cc-calculator__set-brief-intent`, `mcp__cc-calculator__get-brief`

---
```

- [ ] **Step 2: Promote draft-reply to a stage file**

Create `~/.claude/skills/intake/stages/draft-reply.md`:

```markdown
# Stage 5 — Draft Reply (quick_response only)

**Reads:** `brief.raw_body`, `brief.sender_email`, `brief.raw_subject`
**Writes:** `draft_reply` on `briefs` table via `mcp__cc-calculator__set-brief-intent`
**Tools:** `mcp__cc-calculator__set-brief-intent`

## When to run
Only when `intent_type === 'quick_response'`. Skip all other stages.

## What to generate
A short, professional reply in the voice of a Converted Click account manager.
The reply should:
- Acknowledge the request
- Confirm next steps if implied (e.g. "I'll get that rescheduled and send a new invite")
- Be under 80 words
- Not make commitments about pricing or timelines without explicit data

## Output format
Call `mcp__cc-calculator__set-brief-intent` with:
```
intent_type: "quick_response"
draft_reply: "<the reply text>"
```
```

- [ ] **Step 3: Add the new allowed-tools and routing section to SKILL.md**

In `~/.claude/skills/intake/SKILL.md`, update the `allowed-tools` frontmatter to add:

```yaml
  mcp__cc-calculator__set-brief-intelligence
  mcp__cc-calculator__get-brief-intelligence
  mcp__cc-supabase__execute_sql
```

Then add a new section after the existing `## Per-tick algorithm` section:

```markdown
## Brief Intelligence Pipeline

Run this pipeline for every brief where `inserted > 0` AND at least one new message is `inbound`.

### Routing

```
If intent_type == 'quick_response':
  → Run Stage 5 (draft-reply) only. Skip stages 2, 3, 4.

Otherwise:
  → Run Stage 2 (extract-requirements)
  → Run Stage 3 (generate-work-breakdown)
  → Run Stage 4 (synthesise-estimates)
```

Before running any stage, check the existing `audit_trail` via `mcp__cc-calculator__get-brief-intelligence`. If a stage already appears in `audit_trail` with `confidence >= 0.7`, skip it — it has already run successfully.

### Stage files

- `stages/classify-intent.md` — Stage 1 (always runs)
- `stages/extract-requirements.md` — Stage 2
- `stages/generate-work-breakdown.md` — Stage 3
- `stages/synthesise-estimates.md` — Stage 4
- `stages/draft-reply.md` — Stage 5 (quick_response only)

Read the relevant stage file and follow its instructions exactly.

### On stage failure

If a stage fails (tool error, timeout, or invalid output): log to audit_trail with `notes: <error>`, skip remaining stages, call `mcp__cc-calculator__set-brief-intelligence` with `confidence_level: 'low'`. Continue to the next brief — never abort the batch.
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(skill): restructure intake into staged directory with orchestrator routing"
```

---

### Task 9: Write reference files

**Files:**
- Create: `~/.claude/skills/intake/references/business-rules.md`
- Create: `~/.claude/skills/intake/references/department-routing.md`
- Create: `~/.claude/skills/intake/references/estimation-rules.md`
- Create: `~/.claude/skills/intake/references/service-catalog-format.md`
- Create: `~/.claude/skills/intake/references/client-context-format.md`

- [ ] **Step 1: Write `business-rules.md`**

```markdown
# Business Rules — Converted Click

## Engagement types

**Project brief** — one-off engagement with a defined deliverable and end date.
- Creates a new scope record and eventually a project.
- Every requirement must be mapped to a service in the catalog.

**Retainer** — ongoing engagement at a fixed monthly rate.
- Check `mcp__cc-calculator__get-active-retainer` first.
- If the request falls within existing retainer scope: flag as covered, no new pricing.
- If it exceeds retainer scope: flag as out-of-scope, estimate the delta only.

**General query** — no billable deliverable. Document the question and suggested response approach only. No scope or price estimate required.

## Escalation triggers

Flag `confidence_level: 'low'` and add an open question if any of the following are true:
- The client mentions a platform, tool, or technology not represented in the service catalog
- The email is ambiguous between a project brief and a retainer extension
- The estimated price would exceed R 100,000 (likely needs a discovery call before scoping)
- The client references a specific person or team member by name (personnel allocation is manual)

## Department assignment priority

If a service maps to multiple departments, assign to the primary department only.
Strategy always runs first if present. Development always runs after Creative.

## Revision rounds (default assumptions)

Unless the client specifies otherwise:
- Creative deliverables: 2 revision rounds included
- Development deliverables: 1 revision round included
- Copy/content: 2 revision rounds included
```

- [ ] **Step 2: Write `department-routing.md`**

```markdown
# Department Routing — Converted Click

## Department taxonomy

| Department name   | Routes when service involves… |
|---|---|
| Strategy          | brand positioning, campaign planning, audience research, competitive analysis |
| Creative          | design, copywriting, video production, photography, brand identity, social content |
| Development       | website build, web app, CMS, integrations, tracking, technical SEO implementation |
| Paid Media        | Google Ads, Meta Ads, TikTok Ads, programmatic, media buying, ROAS optimisation |
| SEO               | technical audit, keyword research, content briefs, link building, organic growth |
| Social            | organic social scheduling, community management, UGC, influencer coordination |
| Analytics & Data  | reporting dashboards, attribution setup, GA4, Looker Studio, data analysis |
| Account / PM      | project management, client onboarding, reporting delivery (not billable to client) |

## Routing key

Map each matched service to a department using the service's `department_id` field from the services catalog. Do not assign services to departments manually — use the catalog's assignment.

## Dependency ordering

If multiple departments are present, sequence them:
1. Strategy (always first if present)
2. Creative
3. SEO / Social / Paid Media (parallel)
4. Development (after Creative delivers designs)
5. Analytics (after Development deploys)

Record dependencies in the work_breakdown as a `depends_on_department` field.
```

- [ ] **Step 3: Write `estimation-rules.md`**

```markdown
# Estimation Rules — Converted Click

## Three-point hours (PERT)

For every department in the work breakdown, produce three estimates:
- `human_hours_low` — optimistic: everything goes smoothly, no unexpected complexity
- `human_hours_mid` — most likely: normal working pace with one round of client feedback
- `human_hours_high` — pessimistic: scope ambiguity, extra revision rounds, technical blockers

Quote `human_hours_high` as the ceiling for pricing purposes.

## T-shirt size reference

Use this as a sanity check — not as the final estimate:

| Size | Hours (mid) | Typical services |
|---|---|---|
| XS   | 1–4 hrs     | Single social post, minor copy edit, quick report |
| S    | 4–8 hrs     | Blog post, email campaign, basic landing page copy |
| M    | 8–20 hrs    | Multi-post campaign, SEO audit, small web feature |
| L    | 20–60 hrs   | Full campaign, website section redesign, retainer month |
| XL   | 60+ hrs     | Website redesign, brand identity, multi-channel campaign |

## AI efficiency multiplier

For each task, determine if it is `is_ai_eligible`:
- Eligible: first-draft copywriting, image resizing, report generation, data formatting, social caption variants
- Not eligible: strategy, creative direction, client review cycles, stakeholder meetings, QA approval

For eligible tasks: `ai_hours = human_hours_mid × 0.5` (AI does ~half the production work).
Only human hours count against team capacity.

## Confidence scoring

| Level  | When to assign |
|---|---|
| `high`   | All requirements mapped to catalog services, ≤1 open question |
| `medium` | ≥80% of requirements mapped, ≤3 open questions |
| `low`    | <80% mapped, OR >3 open questions, OR escalation trigger hit |

## Price derivation

`estimated_price_cents = sum(sell_price_cents for each matched service in the catalog)`

Use the service's `sell_price_cents` directly — do not recalculate from hours. If a service has no `sell_price_cents`, omit it from the price total and add an open question.
```

- [ ] **Step 4: Write `service-catalog-format.md`**

```markdown
# Service Catalog — How to Read and Use

## Fetching the catalog

Query the services catalog via SQL using `mcp__cc-supabase__execute_sql`:

```sql
SELECT s.id, s.name, s.description, s.sell_price_cents,
       d.name AS department_name, d.id AS department_id,
       s.process_steps_count
FROM services s
LEFT JOIN departments d ON d.id = s.department_id
WHERE s.active = true
ORDER BY d.name, s.name;
```

## Matching services to requirements

For each requirement extracted from the client email:
1. Read the requirement text and interpretation.
2. Find services whose `name` or `description` semantically matches the work described.
3. Prefer exact service matches over approximate ones.
4. A requirement can map to multiple services (e.g. "social media management" → Social Content Creation + Scheduling + Community Management).
5. If no service matches, do NOT invent one — add an open question instead.

## Fetching process steps for matched services

Once services are matched, fetch their process steps (tasks):

```sql
SELECT ps.id, ps.title, ps.description, ps.estimated_hours,
       ps.is_ai_eligible, ps.ordinal,
       d.name AS department_name
FROM process_steps ps
JOIN departments d ON d.id = ps.department_id
WHERE ps.service_id = ANY(ARRAY[<matched_service_ids>]::uuid[])
ORDER BY ps.service_id, ps.ordinal;
```

These become the `tasks[]` in each department's work_breakdown entry.
```

- [ ] **Step 5: Write `client-context-format.md`**

```markdown
# Client Context — How to Read and Apply

## Loading client context

If a `client_id` exists on the brief, load the client's wiki page:

```
mcp__cc-vault__read_note
  path: wiki/clients/<client-slug>/index.md
```

If the path fails, search by client name:
```
mcp__cc-vault__search_notes
  query: <client name>
  limit: 5
```

## What to extract from the wiki page

From the client index page, extract and store in `client_context_snap`:
- `client_name`
- `active_retainer`: { brief_id, monthly_rate_cents, scope_summary } or null
- `active_projects`: [ { project_id, name, status } ] (check via `mcp__cc-calculator__get-active-projects`)
- `preferences`: any noted communication or delivery preferences
- `history_notes`: any relevant past project context

## How to apply client context

**Active retainer found:** Check if the new request falls within the retainer scope summary.
- If covered → flag in summary, set `priority_tier: 'standard'`, no new price estimate needed.
- If out of scope → estimate the delta and flag in open questions.

**Active project found:** If the brief references an existing project (by name or description), set `intent_type: 'project_thread'` and reference the project in the summary.

**No client found:** Proceed without context. Add an open question: "We don't have this sender on file — please confirm which client this is from."
```

- [ ] **Step 6: Commit**

```bash
git add ~/.claude/skills/intake/references/
git commit -m "feat(skill): add business-rules, dept-routing, estimation, service-catalog, client-context reference files"
```

---

### Task 10: Write Stage 2 — `extract-requirements.md`

**Files:**
- Create: `~/.claude/skills/intake/stages/extract-requirements.md`

- [ ] **Step 1: Write the stage file**

```markdown
# Stage 2 — Extract Requirements

**Reads:** `brief.raw_body`, `brief.sender_email`, wiki client context, services catalog
**Writes:** `summary`, `business_objective`, `client_context_snap`, `requirements[]` to `brief_intelligence`
**Tools:** `mcp__cc-vault__read_note`, `mcp__cc-vault__search_notes`, `mcp__cc-supabase__execute_sql`, `mcp__cc-calculator__get-active-projects`, `mcp__cc-calculator__set-brief-intelligence`

## Instructions

Read `references/client-context-format.md` and load client context.
Read `references/service-catalog-format.md` and fetch the active services catalog.

Then analyse the client email and produce the following in a single `mcp__cc-calculator__set-brief-intelligence` call:

### `summary` (string)
2–3 sentences in plain client language. What are they asking for, and why? Do not use agency jargon. Write as if explaining it to a new team member who has never met the client.

### `business_objective` (string)
One sentence: what does a successful outcome look like for the client? Focus on their goal, not the deliverables.

### `client_context_snap` (object)
The extracted client context as per `references/client-context-format.md`.

### `requirements` (array)
Each distinct ask from the email becomes one requirement object:

```json
{
  "text": "the client's exact words or a close paraphrase",
  "interpretation": "what this means operationally — internal language",
  "mapped_service_ids": ["uuid-of-matched-service"],
  "confidence": "high | med | low"
}
```

Rules:
- One requirement per distinct deliverable ask
- If a single sentence covers multiple deliverables, split into multiple requirements
- If no service matches, set `mapped_service_ids: []` and `confidence: 'low'`
- Do NOT invent services — only match from the fetched catalog

### `audit_trail_entry`
```json
{
  "stage": "extract-requirements",
  "completed_at": "<ISO timestamp>",
  "confidence": <0.0–1.0 based on how well requirements mapped>,
  "notes": "<any ambiguities encountered>"
}
```
```

- [ ] **Step 2: Commit**

```bash
git add ~/.claude/skills/intake/stages/extract-requirements.md
git commit -m "feat(skill): add Stage 2 extract-requirements"
```

---

### Task 11: Write Stage 3 — `generate-work-breakdown.md`

**Files:**
- Create: `~/.claude/skills/intake/stages/generate-work-breakdown.md`

- [ ] **Step 1: Write the stage file**

```markdown
# Stage 3 — Generate Work Breakdown

**Reads:** `requirements[].mapped_service_ids` from `brief_intelligence`, process steps for matched services
**Writes:** `work_breakdown[]` to `brief_intelligence`
**Tools:** `mcp__cc-supabase__execute_sql`, `mcp__cc-calculator__set-brief-intelligence`

## Instructions

Read `references/estimation-rules.md` and `references/department-routing.md`.

### Step 1: Fetch process steps

Use `mcp__cc-supabase__execute_sql`:

```sql
SELECT ps.id, ps.title, ps.description, ps.estimated_hours,
       ps.is_ai_eligible, ps.ordinal,
       d.name AS department_name, d.id AS department_id,
       s.id AS service_id, s.name AS service_name
FROM process_steps ps
JOIN departments d ON d.id = ps.department_id
JOIN services s ON s.id = ps.service_id
WHERE ps.service_id = ANY(ARRAY[<comma-separated matched_service_ids>]::uuid[])
ORDER BY d.name, s.name, ps.ordinal;
```

### Step 2: Group by department

Group the process steps by `department_id`. Each group becomes one entry in `work_breakdown`.

### Step 3: For each department, produce

```json
{
  "department_id": "uuid",
  "department_name": "Creative",
  "deliverables": [
    {
      "name": "Instagram carousel posts",
      "format": "PNG 1080×1080",
      "quantity": 3,
      "platform": "Instagram feed",
      "acceptance_criteria": "Client approves final designs in Figma",
      "revision_rounds": 2
    }
  ],
  "tasks": [
    {
      "title": "Design carousel frames",
      "description": "From the process step description",
      "is_ai_eligible": false,
      "process_step_id": "uuid"
    }
  ],
  "human_hours_low": 6,
  "human_hours_mid": 10,
  "human_hours_high": 14,
  "ai_hours": 2
}
```

Rules for hours:
- `human_hours_mid` = sum of `estimated_hours` from process steps for this department
- `human_hours_low` = mid × 0.7 (rounded to nearest 0.5)
- `human_hours_high` = mid × 1.4 (rounded to nearest 0.5)
- `ai_hours` = sum of (estimated_hours × 0.5) for steps where `is_ai_eligible = true`

Deliverables are inferred from the matched service names and the requirement text. Do not invent deliverables not implied by the client email or the matched services.

### Step 4: Write to brief_intelligence

Call `mcp__cc-calculator__set-brief-intelligence` with:
- `brief_id`
- `work_breakdown: <the array>`
- `audit_trail_entry: { stage: "generate-work-breakdown", completed_at: <ISO>, confidence: <0.0–1.0> }`
```

- [ ] **Step 2: Commit**

```bash
git add ~/.claude/skills/intake/stages/generate-work-breakdown.md
git commit -m "feat(skill): add Stage 3 generate-work-breakdown"
```

---

### Task 12: Write Stage 4 — `synthesise-estimates.md`

**Files:**
- Create: `~/.claude/skills/intake/stages/synthesise-estimates.md`

- [ ] **Step 1: Write the stage file**

```markdown
# Stage 4 — Synthesise Estimates

**Reads:** `work_breakdown[]` from `brief_intelligence`, `requirements[]` from `brief_intelligence`
**Writes:** estimation fields + capacity signal + `open_questions` + `confidence_level` to `brief_intelligence`
**Tools:** `mcp__cc-calculator__get-brief-intelligence`, `mcp__cc-supabase__execute_sql`, `mcp__cc-calculator__set-brief-intelligence`

## Instructions

Read `references/estimation-rules.md`.

### Step 1: Fetch current brief_intelligence

```
mcp__cc-calculator__get-brief-intelligence
  brief_id: <brief_id>
```

Extract `work_breakdown` and `requirements`.

### Step 2: Compute totals (arithmetic — do not call Claude for this)

```
total_human_hours_low  = sum(dept.human_hours_low  for dept in work_breakdown)
total_human_hours_mid  = sum(dept.human_hours_mid  for dept in work_breakdown)
total_human_hours_high = sum(dept.human_hours_high for dept in work_breakdown)
total_ai_hours         = sum(dept.ai_hours         for dept in work_breakdown)
```

### Step 3: Compute price

Fetch sell prices for all matched service IDs from requirements:

```sql
SELECT id, sell_price_cents
FROM services
WHERE id = ANY(ARRAY[<all mapped_service_ids from requirements>]::uuid[])
  AND sell_price_cents IS NOT NULL;
```

```
estimated_price_cents = sum(sell_price_cents)
```

### Step 4: Compile open questions

Collect open questions from two sources:
1. Requirements where `mapped_service_ids` is empty → "What service covers: <requirement text>?"
2. Any ambiguity noted in Stage 2 or 3 audit_trail entries

### Step 5: Score confidence

Per `references/estimation-rules.md`:
- Count requirements where `mapped_service_ids` is empty
- Count open questions
- Apply the confidence scoring table

### Step 6: Extract capacity signal from the email

Read the original `brief.raw_body` and extract:
- `inferred_start_date`: any mentioned start date (ISO format) or null
- `inferred_deadline`: any mentioned deadline (ISO format) or null
- `priority_tier`: 'urgent' if email uses words like "urgent", "ASAP", "by EOD"; 'flexible' if no timeline mentioned; otherwise 'standard'

### Step 7: Write everything to brief_intelligence

```
mcp__cc-calculator__set-brief-intelligence
  brief_id: <brief_id>
  total_human_hours_low: <computed>
  total_human_hours_mid: <computed>
  total_human_hours_high: <computed>
  total_ai_hours: <computed>
  estimated_price_cents: <computed>
  confidence_level: <'low'|'medium'|'high'>
  open_questions: <array>
  inferred_start_date: <date or null>
  inferred_deadline: <date or null>
  priority_tier: <'urgent'|'standard'|'flexible'>
  pipeline_version: "1.0"
  audit_trail_entry: {
    stage: "synthesise-estimates",
    completed_at: <ISO timestamp>,
    confidence: <0.0–1.0>
  }
```
```

- [ ] **Step 2: Commit**

```bash
git add ~/.claude/skills/intake/stages/synthesise-estimates.md
git commit -m "feat(skill): add Stage 4 synthesise-estimates"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| brief_intelligence table | Task 1 |
| set-brief-intelligence MCP tool | Task 2 |
| get-brief-intelligence MCP tool | Task 3 |
| Register MCP tools | Task 4 |
| useBriefIntelligence hook | Task 5 |
| BriefIntelligenceView component | Task 6 |
| Scope page redesign | Task 7 |
| Skill directory restructure | Task 8 |
| Reference files (5) | Task 9 |
| Stage 2 extract-requirements | Task 10 |
| Stage 3 generate-work-breakdown | Task 11 |
| Stage 4 synthesise-estimates | Task 12 |
| Stage 1 classify-intent (promoted) | Task 8 |
| Stage 5 draft-reply (promoted) | Task 8 |
| AM approval gate (approve/reject) | Tasks 5 + 7 |
| Scope editor preserved post-approval | Task 7 |
| services_snapshot | Task 2 (field in schema) |
| pipeline_version | Task 12 |
| audit_trail | Tasks 2, 10, 11, 12 |

All spec requirements covered. No gaps.

**Placeholder scan:** No TBDs, no "implement later", no missing code blocks.

**Type consistency:**
- `BriefIntelligence` type comes from `Database["public"]["Tables"]["brief_intelligence"]["Row"]` — set in Task 1, used in Tasks 5, 6, 7. Consistent.
- `useBriefIntelligence` hook returns `BriefIntelligence | null`. Used in `Scope.tsx` with `intelligence ?? null`. Consistent.
- `useApproveBriefIntelligence` and `useRejectBriefIntelligence` take `briefId: string` — called with `id ?? ""` in Scope.tsx. Safe.
- MCP tool `set-brief-intelligence` schema field names match the DB column names. Consistent.
