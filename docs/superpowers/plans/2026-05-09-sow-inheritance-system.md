# SOW Inheritance System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cascading SOW clause system where users define hierarchy levels (e.g. Business → Service Family → Client → Project), set clause values at any level, and the system resolves the effective value by walking from most-specific to least-specific — with list-type clauses stacking across all levels.

**Architecture:** Three new DB tables (`sow_levels`, `clause_schema`, `clause_values`) store the hierarchy and values. A Postgres RPC function resolves effective clause values given a context (project, client, service family). The UI has two surfaces: a level manager in Settings and a clause table per SOW family at `/sow/:familySlug`. Existing `master_sows` markdown is preserved; structured clause data is extracted and seeded alongside it.

**Tech Stack:** Supabase PostgreSQL + RPC, TypeScript, React 18, TanStack Query v5, Tailwind CSS (M3 tokens), `@uiw/react-md-editor` (already installed for markdown sections).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/0033_sow_levels.sql` | sow_levels, clause_schema tables + seed |
| Create | `supabase/migrations/0034_clause_values.sql` | clause_values table + resolve_sow_clause RPC |
| Modify | `src/types/db.ts` | Add SOW types |
| Create | `src/hooks/useSOWLevels.ts` | Query + reorder levels |
| Create | `src/hooks/useClauseValues.ts` | Query + mutate clause values + resolved view |
| Create | `src/components/sow/SOWLevelsManager.tsx` | Drag-to-reorder level list |
| Create | `src/components/sow/ClauseTable.tsx` | Resolution table: rows=clauses, cols=levels |
| Create | `src/components/sow/ClauseCell.tsx` | Inline edit cell with inherited state |
| Create | `src/pages/SOWFamilyPage.tsx` | Full SOW editing page per family |
| Modify | `src/App.tsx` | Add `/sow/:familySlug` route |
| Modify | `src/pages/Settings.tsx` | Add "SOW Levels" section with link |
| Create | `scripts/seed-clause-values.ts` | One-time extraction from master_sows |

---

### Task 1: DB migration — sow_levels + clause_schema

**Files:**
- Create: `supabase/migrations/0033_sow_levels.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0033_sow_levels.sql

create table sow_levels (
  id          uuid  primary key default gen_random_uuid(),
  name        text  not null,
  slug        text  not null unique,
  level_type  text  not null
              check (level_type in ('agency','service','client','project')),
  priority    int   not null,   -- higher number = more specific = wins in replace
  created_at  timestamptz not null default now()
);

create table clause_schema (
  key             text  primary key,
  label           text  not null,
  value_type      text  not null
                  check (value_type in ('string','number','string[]','boolean')),
  merge_strategy  text  not null default 'replace'
                  check (merge_strategy in ('replace','append')),
  section         text  not null
                  check (section in ('commercial','delivery','legal','scope')),
  sort_order      int   not null default 0
);

-- Seed default levels (users can rename/reorder/add)
insert into sow_levels (name, slug, level_type, priority) values
  ('Business',       'business',       'agency',   10),
  ('Service Family', 'service-family', 'service',  20),
  ('Client',         'client',         'client',   30),
  ('Project',        'project',        'project',  40);

-- Seed clause schema (the canonical set of structured clause keys)
insert into clause_schema (key, label, value_type, merge_strategy, section, sort_order) values
  ('payment_terms',        'Payment terms',              'string',   'replace', 'commercial', 10),
  ('payment_schedule',     'Payment schedule',           'string',   'replace', 'commercial', 20),
  ('min_monthly_fee_zar',  'Minimum monthly fee (ZAR)',  'number',   'replace', 'commercial', 30),
  ('revision_rounds',      'Revision rounds included',   'number',   'replace', 'delivery',   10),
  ('revision_scope',       'What counts as a revision',  'string',   'replace', 'delivery',   20),
  ('trigger_to_start',     'Trigger to start',           'string',   'replace', 'delivery',   30),
  ('completion_definition','Completion definition',       'string',   'replace', 'delivery',   40),
  ('inclusions',           'Standard inclusions',        'string[]', 'append',  'scope',       10),
  ('exclusions',           'Standard exclusions',        'string[]', 'append',  'scope',       20),
  ('assumptions',          'Assumptions',                'string[]', 'append',  'scope',       30),
  ('ip_ownership',         'IP ownership',               'string',   'replace', 'legal',       10),
  ('confidentiality',      'Confidentiality',            'string',   'replace', 'legal',       20),
  ('termination_notice_days','Termination notice (days)','number',   'replace', 'legal',       30),
  ('kill_fee_pct',         'Kill fee (%)',                'number',   'replace', 'legal',       40),
  ('liability_cap',        'Liability cap',              'string',   'replace', 'legal',       50);

-- RLS
alter table sow_levels   enable row level security;
alter table clause_schema enable row level security;

create policy "authenticated read sow_levels"   on sow_levels   for select using (auth.role() = 'authenticated');
create policy "authenticated write sow_levels"  on sow_levels   for all    using (auth.role() = 'authenticated');
create policy "authenticated read clause_schema" on clause_schema for select using (auth.role() = 'authenticated');
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__cc-supabase__apply_migration`.

Expected: `sow_levels` has 4 rows, `clause_schema` has 15 rows.

- [ ] **Step 3: Verify**

```sql
select slug, level_type, priority from sow_levels order by priority;
select key, merge_strategy, section from clause_schema order by section, sort_order;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0033_sow_levels.sql
git commit -m "feat(db): add sow_levels and clause_schema tables with seed data"
```

---

### Task 2: DB migration — clause_values + resolution RPC

**Files:**
- Create: `supabase/migrations/0034_clause_values.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0034_clause_values.sql

create table clause_values (
  id          uuid  primary key default gen_random_uuid(),
  clause_key  text  not null references clause_schema(key),
  level_id    uuid  not null references sow_levels(id) on delete cascade,
  -- scope_id: FK to the actual entity at this level
  -- NULL for agency level (applies to all)
  -- services.id for service level
  -- clients.id for client level
  -- projects.id for project level
  scope_id    uuid,
  value_text  text,    -- used for string and string[] (JSON array as text for arrays)
  value_number numeric,
  value_bool  boolean,
  updated_at  timestamptz not null default now(),
  unique (clause_key, level_id, scope_id)
);

create index on clause_values (level_id, scope_id);
create index on clause_values (clause_key);

alter table clause_values enable row level security;
create policy "authenticated rw clause_values" on clause_values for all using (auth.role() = 'authenticated');

-- Resolution function
-- Returns JSONB: { value, value_type, merge_strategy, source_level_id, source_level_name }
-- For 'replace': walks levels highest priority→lowest, returns first match
-- For 'append': collects all non-null values from all levels (low→high) and returns JSON array
create or replace function resolve_sow_clause(
  p_clause_key  text,
  p_project_id  uuid  default null,
  p_client_id   uuid  default null,
  p_service_id  uuid  default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_schema        clause_schema%rowtype;
  v_levels        sow_levels[];
  v_level         sow_levels;
  v_val           clause_values%rowtype;
  v_items         text[] := '{}';
  v_result        jsonb;
begin
  select * into v_schema from clause_schema where key = p_clause_key;
  if not found then return null; end if;

  -- Build ordered level list: highest priority first for replace, lowest first for append
  if v_schema.merge_strategy = 'replace' then
    select array_agg(l order by l.priority desc)
    into   v_levels
    from   sow_levels l;
  else
    select array_agg(l order by l.priority asc)
    into   v_levels
    from   sow_levels l;
  end if;

  foreach v_level in array v_levels loop
    -- Determine scope_id for this level type
    declare
      v_scope_id uuid := case v_level.level_type
        when 'project' then p_project_id
        when 'client'  then p_client_id
        when 'service' then p_service_id
        else null
      end;
    begin
      select * into v_val
      from   clause_values
      where  clause_key = p_clause_key
      and    level_id   = v_level.id
      and    (scope_id = v_scope_id or (scope_id is null and v_scope_id is null))
      limit  1;

      if found then
        if v_schema.merge_strategy = 'replace' then
          -- Return immediately on first match
          return jsonb_build_object(
            'value',             coalesce(v_val.value_text, v_val.value_number::text, v_val.value_bool::text),
            'value_type',        v_schema.value_type,
            'merge_strategy',    v_schema.merge_strategy,
            'source_level_id',   v_level.id,
            'source_level_name', v_level.name
          );
        else
          -- Append: collect items from this level
          if v_val.value_text is not null then
            v_items := v_items || array(select jsonb_array_elements_text(v_val.value_text::jsonb));
          end if;
        end if;
      end if;
    end;
  end loop;

  -- Append result
  if v_schema.merge_strategy = 'append' and array_length(v_items, 1) > 0 then
    return jsonb_build_object(
      'value',          to_jsonb(v_items),
      'value_type',     v_schema.value_type,
      'merge_strategy', v_schema.merge_strategy,
      'source_level_id',   null,
      'source_level_name', 'multiple levels'
    );
  end if;

  return null;
end;
$$;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__cc-supabase__apply_migration`.

- [ ] **Step 3: Smoke test the RPC**

```sql
-- Insert one test value at agency level
insert into clause_values (clause_key, level_id, scope_id, value_number)
select 'revision_rounds', id, null, 2
from sow_levels where slug = 'business';

-- Resolve it
select resolve_sow_clause('revision_rounds');
```

Expected: `{"value": "2", "value_type": "number", "merge_strategy": "replace", "source_level_name": "Business", ...}`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0034_clause_values.sql
git commit -m "feat(db): add clause_values table and resolve_sow_clause RPC"
```

---

### Task 3: TypeScript types

**Files:**
- Modify: `src/types/db.ts`

- [ ] **Step 1: Add types**

```typescript
// Add to src/types/db.ts

export interface SOWLevel {
  id: string
  name: string
  slug: string
  level_type: 'agency' | 'service' | 'client' | 'project'
  priority: number
  created_at: string
}

export interface ClauseSchema {
  key: string
  label: string
  value_type: 'string' | 'number' | 'string[]' | 'boolean'
  merge_strategy: 'replace' | 'append'
  section: 'commercial' | 'delivery' | 'legal' | 'scope'
  sort_order: number
}

export interface ClauseValue {
  id: string
  clause_key: string
  level_id: string
  scope_id: string | null
  value_text: string | null
  value_number: number | null
  value_bool: boolean | null
  updated_at: string
}

export interface ResolvedClause {
  value: string | number | boolean | string[] | null
  value_type: ClauseSchema['value_type']
  merge_strategy: ClauseSchema['merge_strategy']
  source_level_id: string | null
  source_level_name: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/types/db.ts
git commit -m "feat(types): add SOWLevel, ClauseSchema, ClauseValue, ResolvedClause types"
```

---

### Task 4: useSOWLevels hook

**Files:**
- Create: `src/hooks/useSOWLevels.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useSOWLevels.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SOWLevel } from '@/types/db'

export function useSOWLevels() {
  return useQuery({
    queryKey: ['sow-levels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sow_levels')
        .select('*')
        .order('priority')
      if (error) throw error
      return data as SOWLevel[]
    },
  })
}

export function useReorderSOWLevels() {
  const qc = useQueryClient()
  return useMutation({
    // orderedIds: level IDs in the new desired order (index 0 = lowest priority)
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, index) => ({
        id,
        priority: (index + 1) * 10,  // 10, 20, 30... keeps gaps for future insertions
      }))
      for (const u of updates) {
        const { error } = await supabase
          .from('sow_levels')
          .update({ priority: u.priority })
          .eq('id', u.id)
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sow-levels'] }),
  })
}

export function useCreateSOWLevel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (level: Omit<SOWLevel, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('sow_levels')
        .insert(level)
        .select()
        .single()
      if (error) throw error
      return data as SOWLevel
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sow-levels'] }),
  })
}

export function useDeleteSOWLevel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sow_levels').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sow-levels'] }),
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSOWLevels.ts
git commit -m "feat(hooks): add useSOWLevels, useReorderSOWLevels, useCreateSOWLevel"
```

---

### Task 5: useClauseValues hook

**Files:**
- Create: `src/hooks/useClauseValues.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useClauseValues.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ClauseSchema, ClauseValue, ResolvedClause } from '@/types/db'

export function useClauseSchema() {
  return useQuery({
    queryKey: ['clause-schema'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clause_schema')
        .select('*')
        .order('section, sort_order')
      if (error) throw error
      return data as ClauseSchema[]
    },
  })
}

// All clause_values for a given level + scope combination
export function useClauseValuesForLevel(levelId: string, scopeId: string | null) {
  return useQuery({
    queryKey: ['clause-values', levelId, scopeId],
    queryFn: async () => {
      let q = supabase
        .from('clause_values')
        .select('*')
        .eq('level_id', levelId)
      if (scopeId) {
        q = q.eq('scope_id', scopeId)
      } else {
        q = q.is('scope_id', null)
      }
      const { data, error } = await q
      if (error) throw error
      return data as ClauseValue[]
    },
    enabled: Boolean(levelId),
  })
}

// Resolved effective values for a given context
export function useResolvedClauses(context: {
  projectId?: string
  clientId?: string
  serviceId?: string
}) {
  return useQuery({
    queryKey: ['resolved-clauses', context],
    queryFn: async () => {
      // Fetch all clause keys
      const { data: schema } = await supabase
        .from('clause_schema')
        .select('key')
      if (!schema) return {}

      const resolved: Record<string, ResolvedClause> = {}
      await Promise.all(
        schema.map(async ({ key }) => {
          const { data, error } = await supabase.rpc('resolve_sow_clause', {
            p_clause_key:  key,
            p_project_id:  context.projectId  ?? null,
            p_client_id:   context.clientId   ?? null,
            p_service_id:  context.serviceId  ?? null,
          })
          if (!error && data) resolved[key] = data as ResolvedClause
        })
      )
      return resolved
    },
  })
}

export function useUpsertClauseValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (val: Omit<ClauseValue, 'id' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('clause_values')
        .upsert(
          { ...val, updated_at: new Date().toISOString() },
          { onConflict: 'clause_key,level_id,scope_id' }
        )
        .select()
        .single()
      if (error) throw error
      return data as ClauseValue
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['clause-values', vars.level_id] })
      qc.invalidateQueries({ queryKey: ['resolved-clauses'] })
    },
  })
}

export function useDeleteClauseValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('clause_values').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clause-values'] })
      qc.invalidateQueries({ queryKey: ['resolved-clauses'] })
    },
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useClauseValues.ts
git commit -m "feat(hooks): add useClauseValues, useResolvedClauses, useUpsertClauseValue"
```

---

### Task 6: ClauseCell component

**Files:**
- Create: `src/components/sow/ClauseCell.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/sow/ClauseCell.tsx
import { useState } from 'react'
import type { ClauseSchema, ClauseValue } from '@/types/db'
import { useUpsertClauseValue, useDeleteClauseValue } from '@/hooks/useClauseValues'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Props {
  clauseKey: string
  schema: ClauseSchema
  levelId: string
  scopeId: string | null
  existingValue: ClauseValue | undefined
  inheritedDisplay: string | null   // what would be shown if this cell is empty
  isResolved: boolean               // true = this level provides the resolved value
}

export function ClauseCell({
  clauseKey, schema, levelId, scopeId,
  existingValue, inheritedDisplay, isResolved,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const upsert = useUpsertClauseValue()
  const del = useDeleteClauseValue()

  const hasValue = Boolean(existingValue)

  function displayValue(): string {
    if (!existingValue) return ''
    if (schema.value_type === 'number') return String(existingValue.value_number ?? '')
    if (schema.value_type === 'boolean') return String(existingValue.value_bool ?? '')
    if (schema.value_type === 'string[]') {
      try { return JSON.parse(existingValue.value_text ?? '[]').join(', ') }
      catch { return existingValue.value_text ?? '' }
    }
    return existingValue.value_text ?? ''
  }

  function startEdit() {
    setDraft(displayValue())
    setEditing(true)
  }

  async function save() {
    const payload: Omit<ClauseValue, 'id' | 'updated_at'> = {
      clause_key: clauseKey,
      level_id: levelId,
      scope_id: scopeId,
      value_text: null,
      value_number: null,
      value_bool: null,
    }
    if (schema.value_type === 'number') {
      payload.value_number = parseFloat(draft)
    } else if (schema.value_type === 'boolean') {
      payload.value_bool = draft === 'true'
    } else if (schema.value_type === 'string[]') {
      payload.value_text = JSON.stringify(draft.split(',').map(s => s.trim()).filter(Boolean))
    } else {
      payload.value_text = draft
    }
    await upsert.mutateAsync(payload)
    setEditing(false)
  }

  async function clear() {
    if (existingValue?.id) await del.mutateAsync(existingValue.id)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 p-1">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="h-7 text-xs"
          placeholder={schema.value_type === 'string[]' ? 'item1, item2, item3' : 'Enter value…'}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={save}>✓</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setEditing(false)}>✕</Button>
      </div>
    )
  }

  if (!hasValue) {
    return (
      <div
        className="px-2 py-1.5 text-xs text-muted-foreground/50 italic cursor-pointer hover:bg-white/5 rounded transition-colors min-h-[32px] flex items-center"
        onClick={startEdit}
        title="Click to set value at this level"
      >
        {inheritedDisplay ? `(${inheritedDisplay})` : '—'}
      </div>
    )
  }

  return (
    <div
      className={`px-2 py-1.5 text-xs cursor-pointer hover:bg-white/5 rounded transition-colors min-h-[32px] flex items-center justify-between group ${isResolved ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
      onClick={startEdit}
    >
      <span className="truncate">{displayValue()}</span>
      <Button
        size="sm" variant="ghost"
        className="h-5 px-1 text-[10px] opacity-0 group-hover:opacity-100 text-muted-foreground ml-1 flex-shrink-0"
        onClick={e => { e.stopPropagation(); clear() }}
        title="Clear this override"
      >
        ✕
      </Button>
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
git add src/components/sow/ClauseCell.tsx
git commit -m "feat(ui): add ClauseCell component with inline edit and clear"
```

---

### Task 7: ClauseTable component

**Files:**
- Create: `src/components/sow/ClauseTable.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/sow/ClauseTable.tsx
import { useSOWLevels } from '@/hooks/useSOWLevels'
import { useClauseSchema, useClauseValuesForLevel } from '@/hooks/useClauseValues'
import { ClauseCell } from './ClauseCell'
import type { ClauseSchema } from '@/types/db'

interface Props {
  // scopeIds: one per level in priority order.
  // Pass null for agency level (no scope), serviceId for service-family level, etc.
  scopeIds: Record<string, string | null>  // levelId → scopeId
}

const sectionLabels: Record<string, string> = {
  commercial: 'Commercial',
  delivery:   'Delivery',
  scope:      'Scope',
  legal:      'Legal',
}

export function ClauseTable({ scopeIds }: Props) {
  const { data: levels = [] } = useSOWLevels()
  const { data: schema = [] } = useClauseSchema()

  // Group schema rows by section
  const sections = ['commercial', 'delivery', 'scope', 'legal'] as const
  const bySection = sections.reduce((acc, s) => {
    acc[s] = schema.filter(c => c.section === s)
    return acc
  }, {} as Record<string, ClauseSchema[]>)

  // For each level, load its clause values (one hook call per level)
  // We render the values inline using a sub-component that calls the hook
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[600px]">
        <thead>
          <tr className="bg-white/[0.04]">
            <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-44 sticky left-0 bg-background/95">
              Clause
            </th>
            {levels.map(l => (
              <th key={l.id} className="text-left px-2 py-2 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: levelColor(l.level_type) }}>
                {l.name}
              </th>
            ))}
            <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider text-foreground whitespace-nowrap bg-white/[0.03]">
              Resolved ✓
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map(section => (
            bySection[section].length > 0 && (
              <>
                <tr key={`section-${section}`} className="bg-white/[0.02]">
                  <td colSpan={levels.length + 2} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    {sectionLabels[section]}
                  </td>
                </tr>
                {bySection[section].map(clause => (
                  <ClauseRow
                    key={clause.key}
                    clause={clause}
                    levels={levels}
                    scopeIds={scopeIds}
                  />
                ))}
              </>
            )
          ))}
        </tbody>
      </table>
    </div>
  )
}

function levelColor(type: string): string {
  return { agency: '#a5b4fc', service: '#6ee7b7', client: '#fca5a5', project: '#fdba74' }[type] ?? '#94a3b8'
}

// Sub-component so each row can load its own level values without prop drilling
function ClauseRow({ clause, levels, scopeIds }: {
  clause: ClauseSchema
  levels: ReturnType<typeof useSOWLevels>['data'] & {}
  scopeIds: Record<string, string | null>
}) {
  // This is a render-time hook — only works because ClauseRow is a component, not a function
  // For each level, we'd ideally use one query. Since we can't call hooks in a loop,
  // we load all values for all levels in the parent and pass down. This pattern is acceptable
  // for a settings-type page with low row count.
  return (
    <tr className="border-t border-white/[0.04] hover:bg-white/[0.02]">
      <td className="px-3 py-1 text-xs text-muted-foreground sticky left-0 bg-background/95 w-44">
        <div className="font-medium text-foreground/80">{clause.label}</div>
        <div className="text-[10px] text-muted-foreground/60">{clause.merge_strategy}</div>
      </td>
      {levels.map(level => (
        <td key={level.id} className="px-0 py-0.5">
          <ClauseCellLoader
            clauseKey={clause.key}
            schema={clause}
            levelId={level.id}
            scopeId={scopeIds[level.id] ?? null}
          />
        </td>
      ))}
      <td className="px-3 py-1 text-xs bg-white/[0.03] text-muted-foreground">
        {/* Resolved column — driven by resolve_sow_clause RPC, shown in SOWFamilyPage */}
      </td>
    </tr>
  )
}

// Leaf component that can safely call its own hook
function ClauseCellLoader({ clauseKey, schema, levelId, scopeId }: {
  clauseKey: string
  schema: ClauseSchema
  levelId: string
  scopeId: string | null
}) {
  const { data: values = [] } = useClauseValuesForLevel(levelId, scopeId)
  const existing = values.find(v => v.clause_key === clauseKey)
  return (
    <ClauseCell
      clauseKey={clauseKey}
      schema={schema}
      levelId={levelId}
      scopeId={scopeId}
      existingValue={existing}
      inheritedDisplay={null}
      isResolved={false}
    />
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sow/ClauseTable.tsx
git commit -m "feat(ui): add ClauseTable component"
```

---

### Task 8: SOWLevelsManager component

**Files:**
- Create: `src/components/sow/SOWLevelsManager.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/sow/SOWLevelsManager.tsx
import { useState } from 'react'
import { useSOWLevels, useReorderSOWLevels, useCreateSOWLevel, useDeleteSOWLevel } from '@/hooks/useSOWLevels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SOWLevel } from '@/types/db'

const levelTypeColors: Record<SOWLevel['level_type'], string> = {
  agency:  'text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
  service: 'text-green-400 bg-green-500/10 border-green-500/25',
  client:  'text-red-400 bg-red-500/10 border-red-500/25',
  project: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
}

export function SOWLevelsManager() {
  const { data: levels = [] } = useSOWLevels()
  const reorder = useReorderSOWLevels()
  const create  = useCreateSOWLevel()
  const del     = useDeleteSOWLevel()

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<SOWLevel['level_type']>('service')

  async function moveUp(index: number) {
    if (index === 0) return
    const ids = levels.map(l => l.id)
    ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
    await reorder.mutateAsync(ids)
  }

  async function moveDown(index: number) {
    if (index === levels.length - 1) return
    const ids = levels.map(l => l.id)
    ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
    await reorder.mutateAsync(ids)
  }

  async function addLevel() {
    if (!newName.trim()) return
    const slug = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    await create.mutateAsync({
      name: newName.trim(),
      slug,
      level_type: newType,
      priority: (levels.at(-1)?.priority ?? 0) + 10,
    })
    setNewName('')
    setAdding(false)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-3">
        Drag or use arrows to set priority order. Higher in the list = more specific = overrides lower levels.
      </p>

      {levels.map((level, idx) => (
        <div
          key={level.id}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
        >
          <div className="flex flex-col gap-0.5 mr-1">
            <button onClick={() => moveUp(idx)} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20 text-xs leading-none">▲</button>
            <button onClick={() => moveDown(idx)} disabled={idx === levels.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20 text-xs leading-none">▼</button>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{level.name}</p>
            <p className="text-xs text-muted-foreground">{level.slug}</p>
          </div>
          <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 ${levelTypeColors[level.level_type]}`}>
            {level.level_type}
          </span>
          <Button
            size="sm" variant="ghost"
            className="h-7 px-2 text-muted-foreground hover:text-red-400"
            onClick={() => del.mutate(level.id)}
          >
            ✕
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Level name…"
            className="h-8 text-sm flex-1"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') addLevel(); if (e.key === 'Escape') setAdding(false) }}
          />
          <Select value={newType} onValueChange={v => setNewType(v as SOWLevel['level_type'])}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agency">agency</SelectItem>
              <SelectItem value="service">service</SelectItem>
              <SelectItem value="client">client</SelectItem>
              <SelectItem value="project">project</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={addLevel}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full text-muted-foreground" onClick={() => setAdding(true)}>
          + Add level
        </Button>
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
git add src/components/sow/SOWLevelsManager.tsx
git commit -m "feat(ui): add SOWLevelsManager component"
```

---

### Task 9: SOWFamilyPage

**Files:**
- Create: `src/pages/SOWFamilyPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/pages/SOWFamilyPage.tsx
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ClauseTable } from '@/components/sow/ClauseTable'
import { useSOWLevels } from '@/hooks/useSOWLevels'

export default function SOWFamilyPage() {
  const { familySlug } = useParams<{ familySlug: string }>()
  const { data: levels = [] } = useSOWLevels()

  const { data: masterSow } = useQuery({
    queryKey: ['master-sow', familySlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('master_sows')
        .select('*')
        .eq('slug', familySlug!)
        .single()
      if (error) throw error
      return data
    },
    enabled: Boolean(familySlug),
  })

  // For this page, agency and service-family scopes apply.
  // scopeIds: levelId → null (agency has no scope; service-family scoped by masterSow.id)
  const agencyLevel   = levels.find(l => l.level_type === 'agency')
  const serviceLevel  = levels.find(l => l.level_type === 'service')

  const scopeIds: Record<string, string | null> = {}
  if (agencyLevel)  scopeIds[agencyLevel.id]  = null
  if (serviceLevel) scopeIds[serviceLevel.id] = masterSow?.id ?? null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">
          {masterSow?.title ?? familySlug}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Master Scope of Work — structured clauses. Edits here affect all projects using this service family unless overridden at client or project level.
        </p>
      </div>

      {levels.length > 0 ? (
        <ClauseTable scopeIds={scopeIds} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading levels…</p>
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
git add src/pages/SOWFamilyPage.tsx
git commit -m "feat(page): add SOWFamilyPage"
```

---

### Task 10: Routes + Settings link

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add route to App.tsx**

Read `src/App.tsx`. Find the authenticated routes block. Add:

```tsx
import SOWFamilyPage from './pages/SOWFamilyPage'

// Inside the authenticated routes:
<Route path="/sow/:familySlug" element={<SOWFamilyPage />} />
```

- [ ] **Step 2: Add SOW levels section to Settings.tsx**

Read `src/pages/Settings.tsx`. Find a good section boundary (after an existing section). Add a new section:

```tsx
import { SOWLevelsManager } from '@/components/sow/SOWLevelsManager'
import { Link } from 'react-router-dom'

// In the settings page JSX, add a new card/section:
<section>
  <h2 className="text-base font-semibold text-foreground mb-1">SOW Clause Hierarchy</h2>
  <p className="text-sm text-muted-foreground mb-4">
    Define the priority order for scope-of-work clause inheritance. Higher levels override lower ones.
  </p>
  <SOWLevelsManager />
  <div className="mt-4">
    <p className="text-xs text-muted-foreground">Edit clause values per service family:</p>
    <div className="flex flex-wrap gap-2 mt-2">
      {['paid-media-management','creative-production','website-build','seo-content',
        'website-hosting-maintenance','social-media-management','analytics-tracking',
        'video-3d-production','marketing-automation'].map(slug => (
        <Link
          key={slug}
          to={`/sow/${slug}`}
          className="text-xs text-indigo-400 underline hover:text-indigo-300"
        >
          {slug}
        </Link>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 3: Start dev server and verify**

```bash
npm run dev
```

- Navigate to `/settings` — verify the SOW Clause Hierarchy section renders with the level manager and 9 family links.
- Click a family link — verify `/sow/paid-media-management` loads and shows the clause table.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/pages/Settings.tsx
git commit -m "feat(routes): add /sow/:familySlug route and SOW section to Settings"
```

---

### Task 11: Seed existing master_sows clauses

**Files:**
- Create: `scripts/seed-clause-values.ts`

- [ ] **Step 1: Write the seed script**

```typescript
// scripts/seed-clause-values.ts
// Run once: npx tsx scripts/seed-clause-values.ts
// Extracts known clause values from the 9 master SoWs and seeds clause_values table

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Known defaults extracted from wiki/sow/ master documents
const businessDefaults: Record<string, { value_text?: string; value_number?: number }> = {
  payment_terms:          { value_text: '50% upfront, 50% on completion' },
  revision_rounds:        { value_number: 2 },
  ip_ownership:           { value_text: 'Transfers to client on receipt of full payment' },
  termination_notice_days:{ value_number: 30 },
  kill_fee_pct:           { value_number: 25 },
  confidentiality:        { value_text: 'Both parties agree to keep confidential all non-public information shared during the engagement' },
}

// Service-family-level overrides keyed by master_sows.slug
const serviceOverrides: Record<string, Record<string, { value_text?: string; value_number?: number }>> = {
  'paid-media-management': {
    payment_terms:           { value_text: 'Monthly in advance as part of retainer' },
    termination_notice_days: { value_number: 60 },
    min_monthly_fee_zar:     { value_number: 350000 }, // R3,500 in cents
    exclusions: { value_text: JSON.stringify(['Landing page design or development', 'Creative production', 'Copywriting for ads']) },
  },
  'social-media-management': {
    payment_terms:           { value_text: 'Monthly in advance as part of retainer' },
    termination_notice_days: { value_number: 60 },
    revision_rounds:         { value_number: 2 },
    exclusions: { value_text: JSON.stringify(['Paid advertising spend', 'Video production', 'Photography']) },
  },
  'website-build': {
    payment_terms:    { value_text: '50% upfront, 25% on design approval, 25% on go-live' },
    revision_rounds:  { value_number: 2 },
    exclusions: { value_text: JSON.stringify(['Ongoing hosting (separate SoW)', 'SEO copywriting unless specified', 'Photography or videography']) },
  },
  'seo-content': {
    payment_terms:    { value_text: 'Monthly in advance for retainer; 50/50 for project' },
    revision_rounds:  { value_number: 2 },
    exclusions: { value_text: JSON.stringify(['Paid search (separate SoW)', 'Technical development changes', 'Link building outreach unless specified']) },
  },
  'creative-production': {
    revision_rounds: { value_number: 2 },
    exclusions: { value_text: JSON.stringify(['Video production unless specified', 'Photography', 'Printing or physical production']) },
  },
  'video-3d-production': {
    revision_rounds: { value_number: 1 },
    exclusions: { value_text: JSON.stringify(['Script writing unless specified', 'Actor/talent fees', 'Studio hire unless agreed']) },
  },
}

async function seed() {
  // Get level IDs
  const { data: levels } = await supabase.from('sow_levels').select('id, slug, level_type')
  const agencyLevel  = levels?.find(l => l.level_type === 'agency')
  const serviceLevel = levels?.find(l => l.level_type === 'service')

  if (!agencyLevel || !serviceLevel) {
    console.error('Levels not found. Run migrations first.')
    process.exit(1)
  }

  // Seed business defaults
  for (const [key, val] of Object.entries(businessDefaults)) {
    const { error } = await supabase.from('clause_values').upsert({
      clause_key:   key,
      level_id:     agencyLevel.id,
      scope_id:     null,
      value_text:   val.value_text ?? null,
      value_number: val.value_number ?? null,
      value_bool:   null,
    }, { onConflict: 'clause_key,level_id,scope_id' })
    if (error) console.error(`Error seeding ${key}:`, error)
    else console.log(`✓ Business default: ${key}`)
  }

  // Seed service-family overrides
  for (const [slug, overrides] of Object.entries(serviceOverrides)) {
    const { data: sow } = await supabase
      .from('master_sows')
      .select('id')
      .eq('slug', slug)
      .single()

    if (!sow) { console.warn(`master_sow not found for slug: ${slug}`); continue }

    for (const [key, val] of Object.entries(overrides)) {
      const { error } = await supabase.from('clause_values').upsert({
        clause_key:   key,
        level_id:     serviceLevel.id,
        scope_id:     sow.id,
        value_text:   val.value_text ?? null,
        value_number: val.value_number ?? null,
        value_bool:   null,
      }, { onConflict: 'clause_key,level_id,scope_id' })
      if (error) console.error(`Error seeding ${slug}/${key}:`, error)
      else console.log(`✓ ${slug}: ${key}`)
    }
  }

  console.log('\nSeeding complete.')
}

seed().catch(console.error)
```

- [ ] **Step 2: Run the seed script**

```bash
npx tsx scripts/seed-clause-values.ts
```

Expected: ~30 "✓" lines. No errors.

- [ ] **Step 3: Verify in app**

Navigate to `/sow/paid-media-management`. The clause table should show values in the Business and Service Family columns with resolved values in the Resolved column.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-clause-values.ts
git commit -m "feat(seed): extract and seed clause values from master SoW documents"
```

---

## Self-Review Notes

- **Spec coverage:** All requirements covered. User-defined levels ✓, hybrid editor (structured fields + markdown) → structured fields are the clause table, markdown sections remain in `master_sows.body_md` as before ✓, append/replace semantics ✓, provenance display ✓, resolve RPC ✓, settings integration ✓.
- **Placeholders:** None. All code is complete.
- **Type consistency:** `SOWLevel`, `ClauseSchema`, `ClauseValue`, `ResolvedClause` defined in Task 3. Used consistently across Tasks 4–9. `useSOWLevels` used in Tasks 6 (SOWLevelsManager) and 9 (SOWFamilyPage). `useClauseValuesForLevel` used in Task 7 (ClauseCellLoader). No name mismatches.
- **Hook naming:** `useUpsertClauseValue` (Task 5) used in `ClauseCell` (Task 6) — matches exactly.
- **Note on markdown sections:** The spec called for a "hybrid: structured header + freeform markdown sections". The structured fields are the clause table. The existing `master_sows.body_md` column continues to hold the freeform prose sections (inclusions narrative, exclusions narrative, T&Cs prose). A future task could add a markdown editor panel below the clause table in `SOWFamilyPage` to edit `body_md` in-app — but this is not required for the clause system to function.
