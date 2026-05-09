# Workflow / Process Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `process_step_instances` layer to track live project progress step-by-step, extend ClickUp sync to capture per-step timestamps, and surface a horizontal workflow timeline tab in `ProjectScopeView`.

**Architecture:** A new `process_step_instances` table instantiates `process_steps` templates onto live projects. The existing `push-to-clickup` edge function creates one ClickUp task per step instance on project creation. The existing `sync-clickup-actuals` edge function is extended to write `started_at`, `completed_at`, and `actual_hours` back to each instance. A new `WorkflowTimeline` component renders the horizontal block-and-connector view alongside a `WorkflowSummaryPanel`.

**Tech Stack:** Supabase PostgreSQL, TypeScript, React 18, TanStack Query v5, Tailwind CSS (M3 tokens), existing Supabase edge function patterns (Deno).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/0032_process_step_instances.sql` | New table + handoff view |
| Modify | `src/types/db.ts` | Add `ProcessStepInstance` type |
| Create | `src/hooks/useWorkflowSteps.ts` | Query + mutate step instances |
| Modify | `supabase/functions/push-to-clickup/index.ts` | Instantiate steps on project create |
| Modify | `supabase/functions/sync-clickup-actuals/index.ts` | Sync step timestamps + hours |
| Create | `src/components/workflow/WorkflowSummaryPanel.tsx` | Left panel: progress, execution, handoff, calendar |
| Create | `src/components/workflow/WorkflowStepBlock.tsx` | Single step block in timeline |
| Create | `src/components/workflow/WorkflowConnector.tsx` | Gap indicator between blocks |
| Create | `src/components/workflow/WorkflowTimeline.tsx` | Assembles blocks + connectors + summary panel |
| Modify | `src/pages/ProjectScopeView.tsx` | Add "Workflow" tab |

---

### Task 1: DB migration — process_step_instances table

**Files:**
- Create: `supabase/migrations/0032_process_step_instances.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0032_process_step_instances.sql

create table process_step_instances (
  id                uuid        primary key default gen_random_uuid(),
  project_id        uuid        not null references projects(id) on delete cascade,
  template_step_id  uuid        references process_steps(id),
  service_id        uuid        references services(id),
  ordinal           int         not null,
  title             text        not null,
  description       text,
  department_id     uuid        references departments(id),
  assignee_id       uuid        references team_members(id),
  estimated_hours   numeric(6,2),
  actual_hours      numeric(6,2) not null default 0,
  status            text        not null default 'pending'
                    check (status in ('pending','in_progress','blocked','done','skipped')),
  blocked_reason    text,
  is_overridden     boolean     not null default false,
  clickup_task_id   text,
  due_at            timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  last_synced_at    timestamptz,
  manual_override   boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index on process_step_instances (project_id, ordinal);
create index on process_step_instances (clickup_task_id) where clickup_task_id is not null;

-- View: handoff time between consecutive steps
create view process_step_handoffs as
select
  a.project_id,
  a.id                                                            as from_step_id,
  b.id                                                            as to_step_id,
  a.ordinal                                                       as from_ordinal,
  a.title                                                         as from_title,
  b.title                                                         as to_title,
  a.completed_at                                                  as from_completed_at,
  b.started_at                                                    as to_started_at,
  extract(epoch from (b.started_at - a.completed_at)) / 3600.0   as handoff_hours
from   process_step_instances a
join   process_step_instances b
       on  b.project_id = a.project_id
       and b.ordinal    = a.ordinal + 1
where  a.completed_at is not null
and    b.started_at   is not null;

-- RLS: same pattern as project_actuals (authenticated users can read/write their org)
alter table process_step_instances enable row level security;

create policy "authenticated users can read step instances"
  on process_step_instances for select using (auth.role() = 'authenticated');

create policy "authenticated users can insert step instances"
  on process_step_instances for insert with check (auth.role() = 'authenticated');

create policy "authenticated users can update step instances"
  on process_step_instances for update using (auth.role() = 'authenticated');
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__cc-supabase__apply_migration` with the SQL above.

Expected: migration applies without error; `process_step_instances` table and `process_step_handoffs` view exist.

- [ ] **Step 3: Verify via SQL**

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'process_step_instances'
order by ordinal_position;
```

Expected: 20 columns including `started_at`, `completed_at`, `handoff`-related fields.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0032_process_step_instances.sql
git commit -m "feat(db): add process_step_instances table and handoff view"
```

---

### Task 2: TypeScript type

**Files:**
- Modify: `src/types/db.ts`

- [ ] **Step 1: Add the ProcessStepInstance type**

Find the section in `src/types/db.ts` where other table Row types are defined (look for `ProjectActual` or similar) and add:

```typescript
export interface ProcessStepInstance {
  id: string
  project_id: string
  template_step_id: string | null
  service_id: string | null
  ordinal: number
  title: string
  description: string | null
  department_id: string | null
  assignee_id: string | null
  estimated_hours: number | null
  actual_hours: number
  status: 'pending' | 'in_progress' | 'blocked' | 'done' | 'skipped'
  blocked_reason: string | null
  is_overridden: boolean
  clickup_task_id: string | null
  due_at: string | null
  started_at: string | null
  completed_at: string | null
  last_synced_at: string | null
  manual_override: boolean
  created_at: string
  updated_at: string
}

export interface ProcessStepHandoff {
  project_id: string
  from_step_id: string
  to_step_id: string
  from_ordinal: number
  from_title: string
  to_title: string
  from_completed_at: string
  to_started_at: string
  handoff_hours: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/db.ts
git commit -m "feat(types): add ProcessStepInstance and ProcessStepHandoff types"
```

---

### Task 3: useWorkflowSteps hook

**Files:**
- Create: `src/hooks/useWorkflowSteps.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useWorkflowSteps.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ProcessStepInstance, ProcessStepHandoff } from '@/types/db'

export function useWorkflowSteps(projectId: string) {
  return useQuery({
    queryKey: ['workflow-steps', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('process_step_instances')
        .select(`
          *,
          department:departments(id, name, color),
          assignee:team_members(id, full_name)
        `)
        .eq('project_id', projectId)
        .order('ordinal')
      if (error) throw error
      return data as (ProcessStepInstance & {
        department: { id: string; name: string; color: string } | null
        assignee: { id: string; full_name: string } | null
      })[]
    },
    enabled: Boolean(projectId),
  })
}

export function useWorkflowHandoffs(projectId: string) {
  return useQuery({
    queryKey: ['workflow-handoffs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('process_step_handoffs')
        .select('*')
        .eq('project_id', projectId)
        .order('from_ordinal')
      if (error) throw error
      return data as ProcessStepHandoff[]
    },
    enabled: Boolean(projectId),
  })
}

export function useUpdateStepInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Pick<ProcessStepInstance,
        'status' | 'started_at' | 'completed_at' | 'actual_hours' | 'blocked_reason' | 'assignee_id' | 'manual_override'
      >>
    }) => {
      const { data, error } = await supabase
        .from('process_step_instances')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['workflow-steps', data.project_id] })
      qc.invalidateQueries({ queryKey: ['workflow-handoffs', data.project_id] })
    },
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors relating to the new file.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWorkflowSteps.ts
git commit -m "feat(hooks): add useWorkflowSteps, useWorkflowHandoffs, useUpdateStepInstance"
```

---

### Task 4: Extend push-to-clickup — instantiate steps on project creation

**Files:**
- Modify: `supabase/functions/push-to-clickup/index.ts`

- [ ] **Step 1: Read the current push-to-clickup function**

Read `supabase/functions/push-to-clickup/index.ts` to understand the current structure. Find where ClickUp tasks are created (after the project row is inserted).

- [ ] **Step 2: Add step instantiation after project creation**

After the existing code that creates ClickUp tasks per service, add the following block. Insert it before the final `return json({...})`:

```typescript
// --- Instantiate process steps for this project ---
// Collect all service IDs from the quote
const { data: quoteServices } = await serviceClient
  .from('quote_services')
  .select('service_id, ordinal')
  .eq('quote_id', quoteId)
  .order('ordinal')

if (quoteServices && quoteServices.length > 0) {
  const serviceIds = quoteServices.map((qs: { service_id: string }) => qs.service_id)

  const { data: templateSteps } = await serviceClient
    .from('process_steps')
    .select('*')
    .in('service_id', serviceIds)
    .order('service_id, ordinal')

  if (templateSteps && templateSteps.length > 0) {
    // Global ordinal across all services (ordered by quote line ordinal, then step ordinal)
    const serviceOrderMap = Object.fromEntries(
      quoteServices.map((qs: { service_id: string; ordinal: number }, i: number) => [qs.service_id, i])
    )
    const sorted = [...templateSteps].sort((a, b) => {
      const serviceOrd = serviceOrderMap[a.service_id] - serviceOrderMap[b.service_id]
      return serviceOrd !== 0 ? serviceOrd : a.ordinal - b.ordinal
    })

    const instances = sorted.map((step: any, idx: number) => ({
      project_id: projectId,
      template_step_id: step.id,
      service_id: step.service_id,
      ordinal: idx + 1,
      title: step.title,
      description: step.description ?? null,
      department_id: step.department_id ?? null,
      estimated_hours: step.estimated_hours ?? null,
      status: 'pending' as const,
    }))

    const { data: inserted, error: insertError } = await serviceClient
      .from('process_step_instances')
      .insert(instances)
      .select('id, title, ordinal')

    if (insertError) {
      console.error('Failed to instantiate process steps:', insertError)
      // Non-fatal — project creation succeeds even if step instantiation fails
    } else if (inserted) {
      // Create one ClickUp task per step instance and store clickup_task_id
      // Uses the same ClickUp list as the parent project
      for (const instance of inserted) {
        try {
          const taskRes = await fetch(
            `https://api.clickup.com/api/v2/list/${clickupListId}/task`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: clickupToken,
              },
              body: JSON.stringify({
                name: `[Step ${instance.ordinal}] ${instance.title}`,
                parent: clickupParentTaskId ?? undefined,
                custom_fields: customFields,
              }),
            }
          )
          if (taskRes.ok) {
            const taskData = await taskRes.json()
            await serviceClient
              .from('process_step_instances')
              .update({ clickup_task_id: taskData.id })
              .eq('id', instance.id)
          }
        } catch (e) {
          console.error(`Failed to create ClickUp task for step ${instance.ordinal}:`, e)
          // Continue — other steps should still be created
        }
      }
    }
  }
}
// --- End step instantiation ---
```

**Note:** `serviceClient`, `quoteId`, `projectId`, `clickupListId`, `clickupParentTaskId`, `clickupToken`, and `customFields` are variables already in scope in the existing function. Read the file first to confirm their exact names.

- [ ] **Step 3: Deploy the function**

```bash
supabase functions deploy push-to-clickup
```

Or use `mcp__cc-supabase__deploy_edge_function` with function name `push-to-clickup`.

- [ ] **Step 4: Smoke test**

Accept a test quote in the app and verify:
1. `process_step_instances` rows are created for the project
2. Each row has a `clickup_task_id` (if the service had process steps)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/push-to-clickup/index.ts
git commit -m "feat(edge): instantiate process_step_instances and ClickUp tasks on project creation"
```

---

### Task 5: Extend sync-clickup-actuals — write step timestamps

**Files:**
- Modify: `supabase/functions/sync-clickup-actuals/index.ts`

- [ ] **Step 1: Read the current sync function**

Read `supabase/functions/sync-clickup-actuals/index.ts`. Find where task data is fetched from ClickUp and written to `project_actuals`.

- [ ] **Step 2: Add step instance sync after the existing project_actuals write**

After the block that upserts to `project_actuals`, add:

```typescript
// --- Sync process_step_instances ---
const { data: stepInstances } = await serviceClient
  .from('process_step_instances')
  .select('id, clickup_task_id, manual_override')
  .eq('project_id', projectId)
  .not('clickup_task_id', 'is', null)

if (stepInstances && stepInstances.length > 0) {
  for (const instance of stepInstances) {
    // Skip instances the ops manager has manually overridden
    if (instance.manual_override) continue

    // Fetch task from ClickUp
    try {
      const taskRes = await fetch(
        `https://api.clickup.com/api/v2/task/${instance.clickup_task_id}?include_subtasks=false`,
        { headers: { Authorization: clickupToken } }
      )
      if (!taskRes.ok) continue
      const task = await taskRes.json()

      // Map ClickUp status to our status enum
      const statusMap: Record<string, string> = {
        'to do': 'pending',
        'in progress': 'in_progress',
        'complete': 'done',
        'done': 'done',
        'blocked': 'blocked',
      }
      const mappedStatus = statusMap[task.status?.status?.toLowerCase()] ?? 'pending'

      // ClickUp stores time_estimate and time_spent in milliseconds
      const actualHours = task.time_spent ? task.time_spent / 3_600_000 : 0

      // ClickUp date_created / date_updated are ms epoch strings
      const startedAt = task.start_date
        ? new Date(parseInt(task.start_date)).toISOString()
        : null
      const completedAt = mappedStatus === 'done' && task.date_closed
        ? new Date(parseInt(task.date_closed)).toISOString()
        : null

      await serviceClient
        .from('process_step_instances')
        .update({
          status: mappedStatus,
          actual_hours: actualHours,
          started_at: startedAt,
          completed_at: completedAt,
          last_synced_at: new Date().toISOString(),
          manual_override: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', instance.id)
    } catch (e) {
      console.error(`Failed to sync step instance ${instance.id}:`, e)
    }
  }
}
// --- End step instance sync ---
```

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy sync-clickup-actuals
```

Or use `mcp__cc-supabase__deploy_edge_function`.

- [ ] **Step 4: Smoke test**

Trigger the sync on a project that has `process_step_instances`. Verify `started_at`, `completed_at`, `actual_hours` populate.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sync-clickup-actuals/index.ts
git commit -m "feat(edge): sync process_step_instances timestamps from ClickUp"
```

---

### Task 6: WorkflowSummaryPanel component

**Files:**
- Create: `src/components/workflow/WorkflowSummaryPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/workflow/WorkflowSummaryPanel.tsx
import type { ProcessStepInstance, ProcessStepHandoff } from '@/types/db'

interface Props {
  steps: ProcessStepInstance[]
  handoffs: ProcessStepHandoff[]
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  return rem > 0 ? `${days}d ${rem.toFixed(0)}h` : `${days}d`
}

export function WorkflowSummaryPanel({ steps, handoffs }: Props) {
  const done = steps.filter(s => s.status === 'done')
  const active = steps.find(s => s.status === 'in_progress')

  const estHours = done.reduce((sum, s) => sum + (s.estimated_hours ?? 0), 0)
  const actHours = done.reduce((sum, s) => sum + s.actual_hours, 0)
  const varianceH = actHours - estHours
  const variancePct = estHours > 0 ? Math.round((varianceH / estHours) * 100) : 0

  const totalHandoffH = handoffs.reduce((sum, h) => sum + h.handoff_hours, 0)
  const longestHandoff = handoffs.reduce<ProcessStepHandoff | null>(
    (max, h) => (!max || h.handoff_hours > max.handoff_hours ? h : max),
    null
  )

  const progressPct = steps.length > 0 ? Math.round((done.length / steps.length) * 100) : 0
  const totalCalendarH = actHours + totalHandoffH
  const waitingPct = totalCalendarH > 0 ? Math.round((totalHandoffH / totalCalendarH) * 100) : 0

  const varianceColor = varianceH <= 0 ? 'text-green-400' : variancePct > 20 ? 'text-red-400' : 'text-amber-400'

  return (
    <div className="flex flex-col gap-3 w-60 flex-shrink-0">
      {/* Progress */}
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Progress</p>
        <p className="text-2xl font-bold text-foreground leading-none">
          {done.length} <span className="text-sm font-normal text-muted-foreground">of {steps.length} steps</span>
        </p>
        <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-green-400 to-indigo-400 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {active && (
          <p className="mt-1.5 text-[11px] text-indigo-400">Step {active.ordinal} in progress</p>
        )}
      </div>

      {/* Execution time */}
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Execution time</p>
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-sm text-muted-foreground">Estimated</span>
          <span className="text-[15px] font-semibold text-foreground">{formatDuration(estHours)}</span>
        </div>
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-sm text-muted-foreground">Actual</span>
          <span className={`text-[15px] font-semibold ${varianceH > 0 ? 'text-amber-400' : 'text-green-400'}`}>
            {formatDuration(actHours)}
          </span>
        </div>
        <div className="h-px bg-white/10 my-2" />
        <div className="flex justify-between">
          <span className="text-[11px] text-muted-foreground">Variance</span>
          <span className={`text-xs font-semibold ${varianceColor}`}>
            {varianceH >= 0 ? '+' : ''}{formatDuration(Math.abs(varianceH))} ({variancePct >= 0 ? '↑' : '↓'}{Math.abs(variancePct)}%)
          </span>
        </div>
      </div>

      {/* Handoff time */}
      {handoffs.length > 0 && (
        <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/[0.08] p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-1.5">Handoff time</p>
          <p className="text-2xl font-bold text-indigo-300 leading-none mb-2">
            {formatDuration(totalHandoffH)}
          </p>
          <div className="flex flex-col gap-1">
            {handoffs.map(h => (
              <div key={h.from_step_id} className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">{h.from_ordinal} → {h.from_ordinal + 1}</span>
                <span className={h.handoff_hours > 24 ? 'text-red-400 font-semibold' : h.handoff_hours > 4 ? 'text-amber-400' : 'text-green-400'}>
                  {formatDuration(h.handoff_hours)}
                  {longestHandoff?.from_step_id === h.from_step_id && ' ← longest'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calendar time */}
      {totalCalendarH > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Calendar time</p>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Working</span>
            <span className="text-foreground">{formatDuration(actHours)}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Waiting</span>
            <span className="text-indigo-300">{formatDuration(totalHandoffH)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden flex mb-1.5">
            <div className="h-full bg-green-400" style={{ width: `${100 - waitingPct}%` }} />
            <div className="h-full bg-indigo-500" style={{ width: `${waitingPct}%` }} />
          </div>
          <p className={`text-[11px] ${waitingPct > 50 ? 'text-red-400' : 'text-muted-foreground'}`}>
            {waitingPct}% of elapsed time is waiting
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workflow/WorkflowSummaryPanel.tsx
git commit -m "feat(ui): add WorkflowSummaryPanel component"
```

---

### Task 7: WorkflowStepBlock + WorkflowConnector components

**Files:**
- Create: `src/components/workflow/WorkflowStepBlock.tsx`
- Create: `src/components/workflow/WorkflowConnector.tsx`

- [ ] **Step 1: Write WorkflowStepBlock**

```tsx
// src/components/workflow/WorkflowStepBlock.tsx
import type { ProcessStepInstance } from '@/types/db'

interface Props {
  step: ProcessStepInstance & {
    department: { name: string; color: string } | null
    assignee: { full_name: string } | null
  }
}

const statusConfig = {
  done:        { label: 'Done ✓',  border: 'border-green-500/40',  bg: 'bg-green-500/10',  text: 'text-green-400'  },
  in_progress: { label: 'Active ●', border: 'border-indigo-400/60', bg: 'bg-indigo-500/15', text: 'text-indigo-300' },
  blocked:     { label: 'Blocked', border: 'border-red-500/40',    bg: 'bg-red-500/10',    text: 'text-red-400'    },
  pending:     { label: 'Pending', border: 'border-white/10',      bg: 'bg-white/[0.02]',  text: 'text-muted-foreground' },
  skipped:     { label: 'Skipped', border: 'border-white/10',      bg: 'bg-white/[0.02]',  text: 'text-muted-foreground' },
}

function varianceColor(estimated: number | null, actual: number): string {
  if (!estimated || actual === 0) return ''
  const ratio = actual / estimated
  if (ratio <= 1.0) return 'text-green-400'
  if (ratio <= 1.2) return 'text-amber-400'
  return 'text-red-400'
}

export function WorkflowStepBlock({ step }: Props) {
  const cfg = statusConfig[step.status]
  const isDone = step.status === 'done'
  const isPending = step.status === 'pending' || step.status === 'skipped'

  return (
    <div
      className={`
        flex-shrink-0 w-24 rounded-lg border p-2.5 text-center
        ${cfg.border} ${cfg.bg}
        ${isPending ? 'opacity-40' : ''}
        ${step.status === 'in_progress' ? 'border-[1.5px]' : ''}
      `}
    >
      <p className={`text-[9px] font-bold uppercase tracking-wide ${cfg.text} mb-0.5`}>
        {cfg.label}
      </p>
      <p className="text-[13px] font-semibold text-foreground leading-tight mb-0.5 truncate">
        {step.title}
      </p>
      {step.assignee && (
        <p className="text-[10px] text-muted-foreground truncate">
          {step.assignee.full_name.split(' ')[0]}
        </p>
      )}
      {isDone && step.estimated_hours && (
        <p className={`text-[11px] font-semibold mt-1 ${varianceColor(step.estimated_hours, step.actual_hours)}`}>
          {step.actual_hours.toFixed(1)}h
          <span className="text-[9px] opacity-70 ml-0.5">/ {step.estimated_hours}h</span>
        </p>
      )}
      {step.status === 'in_progress' && (
        <p className="text-[11px] text-indigo-300 font-semibold mt-1">
          {step.actual_hours.toFixed(1)}h…
          <span className="text-[9px] opacity-70 ml-0.5">/ {step.estimated_hours ?? '?'}h</span>
        </p>
      )}
      {isPending && step.estimated_hours && (
        <p className="text-[11px] text-muted-foreground mt-1">est. {step.estimated_hours}h</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write WorkflowConnector**

```tsx
// src/components/workflow/WorkflowConnector.tsx

interface Props {
  handoffHours: number | null  // null = step not yet completed (pending handoff)
}

function formatHandoff(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const d = Math.floor(hours / 24)
  const h = Math.round(hours % 24)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

export function WorkflowConnector({ handoffHours }: Props) {
  if (handoffHours === null) {
    return (
      <div className="flex-shrink-0 w-11 flex flex-col items-center opacity-20">
        <div className="w-full h-0.5 bg-white/25" />
      </div>
    )
  }

  const isLong   = handoffHours > 24
  const isMedium = handoffHours > 4

  const lineColor  = isLong ? 'bg-red-500/70'    : isMedium ? 'bg-amber-500/60'   : 'bg-green-500/50'
  const labelBg    = isLong ? 'bg-red-500/15'     : isMedium ? 'bg-amber-500/15'   : 'bg-green-500/10'
  const labelBorder = isLong ? 'border-red-500/40' : isMedium ? 'border-amber-500/35' : 'border-green-500/30'
  const labelText  = isLong ? 'text-red-400'      : isMedium ? 'text-amber-400'    : 'text-green-400'

  return (
    <div className="flex-shrink-0 w-11 flex flex-col items-center gap-1">
      <div className={`w-full h-0.5 ${lineColor}`} />
      <div className={`border rounded-full px-1.5 py-px text-[9px] font-semibold ${labelBg} ${labelBorder} ${labelText} whitespace-nowrap`}>
        {formatHandoff(handoffHours)}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/workflow/WorkflowStepBlock.tsx src/components/workflow/WorkflowConnector.tsx
git commit -m "feat(ui): add WorkflowStepBlock and WorkflowConnector components"
```

---

### Task 8: WorkflowTimeline — assembler component

**Files:**
- Create: `src/components/workflow/WorkflowTimeline.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/workflow/WorkflowTimeline.tsx
import { useWorkflowSteps, useWorkflowHandoffs } from '@/hooks/useWorkflowSteps'
import { WorkflowSummaryPanel } from './WorkflowSummaryPanel'
import { WorkflowStepBlock } from './WorkflowStepBlock'
import { WorkflowConnector } from './WorkflowConnector'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useQueryClient } from '@tanstack/react-query'

interface Props {
  projectId: string
  projectName: string
}

export function WorkflowTimeline({ projectId, projectName }: Props) {
  const { data: steps = [], isLoading } = useWorkflowSteps(projectId)
  const { data: handoffs = [] } = useWorkflowHandoffs(projectId)
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  const activeStep = steps.find(s => s.status === 'in_progress')

  // Build a map of handoff hours keyed by from_ordinal for O(1) lookup
  const handoffMap = new Map(handoffs.map(h => [h.from_ordinal, h.handoff_hours]))

  async function handleSync() {
    setSyncing(true)
    try {
      await supabase.functions.invoke('sync-clickup-actuals', {
        body: { projectId },
      })
      qc.invalidateQueries({ queryKey: ['workflow-steps', projectId] })
      qc.invalidateQueries({ queryKey: ['workflow-handoffs', projectId] })
    } finally {
      setSyncing(false)
    }
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading workflow…</div>
  }

  if (steps.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No process steps defined for the services in this project.{' '}
        <a href="/services" className="text-indigo-400 underline">
          Add steps to services
        </a>{' '}
        to enable workflow tracking.
      </div>
    )
  }

  return (
    <div className="flex gap-4 p-4">
      {/* Left: summary panel */}
      <WorkflowSummaryPanel steps={steps} handoffs={handoffs} />

      {/* Right: timeline */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{projectName}</span>
            {activeStep && (
              <span className="bg-indigo-500/20 text-indigo-300 rounded-full px-2.5 py-0.5 text-[11px]">
                Step {activeStep.ordinal} in progress
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="text-xs text-muted-foreground"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync now
          </Button>
        </div>

        {/* Horizontal step blocks */}
        <div className="flex items-center flex-wrap gap-y-3 overflow-x-auto pb-2">
          {steps.map((step, idx) => (
            <div key={step.id} className="flex items-center">
              <WorkflowStepBlock step={step as any} />
              {idx < steps.length - 1 && (
                <WorkflowConnector
                  handoffHours={handoffMap.get(step.ordinal) ?? null}
                />
              )}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-3 text-[10px] text-muted-foreground flex-wrap">
          <span>Blocks: <span className="text-green-400">■</span> under est <span className="text-amber-400 ml-1">■</span> slightly over <span className="text-red-400 ml-1">■</span> over</span>
          <span>Connectors: <span className="text-green-400">■</span> short wait <span className="text-red-400 ml-1">■</span> long wait</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workflow/WorkflowTimeline.tsx
git commit -m "feat(ui): add WorkflowTimeline assembler component"
```

---

### Task 9: Add Workflow tab to ProjectScopeView

**Files:**
- Modify: `src/pages/ProjectScopeView.tsx`

- [ ] **Step 1: Read the existing tab structure**

Read `src/pages/ProjectScopeView.tsx`. Find the `TabsList` and `TabsContent` blocks. Note the exact tab values used (e.g. `"inbox"`, `"brief"`, `"activity"`, `"tasks"`, `"quote"`, `"time"`).

- [ ] **Step 2: Add the import**

At the top of `ProjectScopeView.tsx`, add:

```typescript
import { WorkflowTimeline } from '@/components/workflow/WorkflowTimeline'
```

- [ ] **Step 3: Add the tab trigger**

Inside `<TabsList>`, after the existing tab triggers, add:

```tsx
<TabsTrigger value="workflow">Workflow</TabsTrigger>
```

- [ ] **Step 4: Add the tab content**

After the last `<TabsContent>` block, add:

```tsx
<TabsContent value="workflow">
  <WorkflowTimeline
    projectId={project.id}
    projectName={project.name}
  />
</TabsContent>
```

Replace `project.id` and `project.name` with however the current component accesses the project object (read the file to confirm the variable name).

- [ ] **Step 5: Start dev server and verify the tab appears**

```bash
npm run dev
```

Navigate to a project's scope view at `/clients/:clientId/projects/:projectId`. Verify the "Workflow" tab appears and renders without errors. If the project has no step instances, the empty state message should show.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectScopeView.tsx
git commit -m "feat(ui): add Workflow tab to ProjectScopeView"
```

---

### Task 10: Seed process steps for the top 15 services

**Files:**
- Modify: `src/pages/Services*.tsx` (use existing AI generation UI per service)

- [ ] **Step 1: Identify the 15 most-used services**

Run via Supabase MCP:

```sql
select s.id, s.name, count(qs.id) as quote_count
from services s
join quote_services qs on qs.service_id = s.id
group by s.id, s.name
order by quote_count desc
limit 15;
```

- [ ] **Step 2: For each service in the list**

Navigate to `/services/:id` in the app. Use the existing "Generate steps with AI" button in `ProcessFlow.tsx` to populate steps. Review and save.

Repeat for all 15 services.

- [ ] **Step 3: Verify**

```sql
select s.name, count(ps.id) as step_count
from services s
left join process_steps ps on ps.service_id = s.id
group by s.id, s.name
having count(ps.id) > 0
order by step_count desc;
```

Expected: at least 15 services with process steps.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(data): seed process steps for top 15 services via AI generation"
```

---

## Self-Review Notes

- **Spec coverage:** All spec requirements covered. `process_step_handoffs` view ✓, ClickUp hybrid sync ✓, horizontal timeline with summary panel ✓, empty state ✓, one task per step on project creation ✓.
- **Placeholders:** None. All code is complete.
- **Type consistency:** `ProcessStepInstance` defined in Task 2, used in Tasks 3, 6, 7, 8. `ProcessStepHandoff` defined in Task 2, used in Tasks 6, 8. `formatDuration` defined in Task 6 (WorkflowSummaryPanel) — not needed in other components. `formatHandoff` defined separately in Task 7 (WorkflowConnector) for its own formatting needs — intentional, slightly different format.
- **Breaking change noted:** New projects get one ClickUp task per step. Existing projects unaffected.
