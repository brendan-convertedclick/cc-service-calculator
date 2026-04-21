# Compound Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a service include other services as scope, with its department-hour allocation derived from the children's resolved hours unless the parent defines its own checklist.

**Architecture:** One migration adds `service_children(parent_id, child_id, ordinal, quantity)` with a cycle-prevention trigger, and rewrites `service_allocation_resolved` as a recursive CTE with three precedence tiers (own checklist → children sum × quantity → rule fallback). Frontend adds a hook + component for managing children on the service detail page, makes ProcessFlow mode-aware (derived vs override), and updates the grid to show a bundle badge + read-only cells for services whose allocation comes from children.

**Tech Stack:** Supabase Postgres (migrations via `mcp__cc-supabase__apply_migration` or Management API curl), Vite + React 18 + TypeScript, TanStack Query, Tailwind + shadcn/ui, Vitest.

**Spec reference:** [docs/superpowers/specs/2026-04-21-compound-services-design.md](../specs/2026-04-21-compound-services-design.md)

---

## File Structure

**Migrations**
- Create: `supabase/migrations/0004_compound_services.sql` — `service_children` table, RLS, cycle trigger, rewritten `service_allocation_resolved` view

**Types**
- Regenerate: `src/types/db.ts` after migration lands

**Hooks**
- Create: `src/hooks/useServiceChildren.ts` — list / create / update quantity / remove / reorder for a parent's children; plus `useServiceAncestors` (for the picker's cycle-avoidance filter) and `useServicesForPicker` (lightweight name+id list)
- Modify: `src/hooks/useServices.ts` — add `childCounts: Map<string, number>` to `AllocationMatrix` so the grid knows which services are compound

**Components**
- Create: `src/components/IncludedServices.tsx` — list of children with add-picker, quantity input, up/down reorder, remove
- Modify: `src/components/ProcessFlow.tsx` — derived/override modes, `Seed from children`, `Revert to derived`, hide rule-fallback controls when in derived mode
- Create: `src/components/ServicePicker.tsx` — searchable combobox used by `IncludedServices`'s Add button

**Pages**
- Modify: `src/pages/ServiceDetail.tsx` — mount `IncludedServices` above `ProcessFlow` in the right column; thread child count / derived-mode flag to `ProcessFlow`
- Modify: `src/pages/ServicesList.tsx` — bundle badge + child count, dash rule column when derived, read-only dept cells when `childCounts > 0 && !hasChecklist`

**No changes:** `src/lib/allocation.ts` (the recursive sum is in SQL; no new client-side math).

---

## Task 1: Write the migration SQL

**Files:**
- Create: `supabase/migrations/0004_compound_services.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0004_compound_services.sql`:

```sql
-- CC Service Calculator — compound services
-- Apply via mcp__cc-supabase__apply_migration (name: compound_services)

-- ============================================================
-- 1. service_children table
-- ============================================================

create table if not exists public.service_children (
  parent_id    uuid not null references public.services(id) on delete cascade,
  child_id     uuid not null references public.services(id) on delete restrict,
  ordinal      int  not null,
  quantity     int  not null default 1 check (quantity >= 1),
  created_at   timestamptz not null default now(),
  primary key (parent_id, ordinal),
  unique (parent_id, child_id),
  check (parent_id <> child_id)
);

create index if not exists idx_service_children_child on public.service_children(child_id);

-- ============================================================
-- 2. RLS — single authenticated policy, matching every other table
-- ============================================================

alter table public.service_children enable row level security;

drop policy if exists "service_children authenticated all" on public.service_children;
create policy "service_children authenticated all"
  on public.service_children
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- 3. Cycle-prevention trigger
-- ============================================================

create or replace function public.tg_service_children_no_cycle()
returns trigger
language plpgsql
as $$
declare
  cycle_found boolean;
begin
  -- Walk ancestors of NEW.parent_id; if NEW.child_id appears in the ancestor
  -- chain, inserting NEW would create a cycle.
  with recursive ancestors as (
    select NEW.parent_id as node_id, 0 as depth
    union all
    select sc.parent_id, a.depth + 1
    from public.service_children sc
    join ancestors a on sc.child_id = a.node_id
    where a.depth < 20
  )
  select exists (select 1 from ancestors where node_id = NEW.child_id)
    into cycle_found;

  if cycle_found then
    raise exception 'Adding this child would create a cycle in the service tree';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_service_children_no_cycle on public.service_children;
create trigger trg_service_children_no_cycle
  before insert or update on public.service_children
  for each row execute function public.tg_service_children_no_cycle();

-- ============================================================
-- 4. Rewrite service_allocation_resolved with three-tier recursion
-- ============================================================

create or replace view public.service_allocation_resolved as
with recursive
step_sums as (
  select
    service_id,
    department_id,
    sum(estimated_hours)::numeric as hours
  from public.process_steps
  where department_id is not null and estimated_hours is not null
  group by service_id, department_id
),
tree as (
  -- Root: every service, as its own depth-0 node, quantity 1
  select
    s.id as root_id,
    s.id as node_id,
    1::int as quantity,
    0 as depth
  from public.services s

  union all

  -- Walk children only when the current node has no own checklist
  select
    t.root_id,
    sc.child_id,
    (t.quantity * sc.quantity)::int,
    t.depth + 1
  from tree t
  join public.service_children sc on sc.parent_id = t.node_id
  where not exists (select 1 from step_sums ss where ss.service_id = t.node_id)
    and t.depth < 10
),
derived as (
  -- For each root, collect step_sums from any node in its tree, but only:
  --   (a) when the root itself has no own checklist, OR
  --   (b) at the root node (so a service WITH its own checklist returns its own hours)
  select
    t.root_id as service_id,
    ss.department_id,
    sum(ss.hours * t.quantity)::numeric as hours
  from tree t
  join step_sums ss on ss.service_id = t.node_id
  where not exists (select 1 from step_sums x where x.service_id = t.root_id)
     or t.node_id = t.root_id
  group by t.root_id, ss.department_id
),
derived_plus_price as (
  select
    d.service_id,
    d.department_id,
    d.hours,
    dep.hourly_rate_cents,
    s.sell_price_cents,
    s.pricing_model
  from derived d
  join public.services s on s.id = d.service_id
  join public.departments d_q on d_q.id = d.department_id  -- unused alias kept for clarity
  join public.departments dep on dep.id = d.department_id
),
services_with_derived as (
  select distinct service_id from derived
),
rule_fallback as (
  select
    s.id as service_id,
    ra.department_id,
    case
      when s.pricing_model = 'percentage' or s.sell_price_cents <= 0 or dep.hourly_rate_cents <= 0
        then 0::numeric
      else round((ra.pct * s.sell_price_cents / dep.hourly_rate_cents / 100.0)::numeric, 2)
    end as hours,
    dep.hourly_rate_cents,
    s.sell_price_cents,
    s.pricing_model,
    ra.pct
  from public.services s
  join public.rule_allocations ra on ra.rule_id = s.rule_id
  join public.departments dep on dep.id = ra.department_id
  where s.rule_id is not null
    and not exists (select 1 from services_with_derived swd where swd.service_id = s.id)
)
select
  service_id,
  department_id,
  case
    when pricing_model = 'percentage' or sell_price_cents <= 0 then null
    else round((hours * hourly_rate_cents * 100.0 / sell_price_cents)::numeric, 2)
  end as pct,
  case
    when pricing_model = 'percentage' then 0
    else round(hours * hourly_rate_cents)::int
  end as price_share_cents,
  hours
from derived_plus_price

union all

select
  service_id,
  department_id,
  pct,
  case
    when pricing_model = 'percentage' then 0
    else round(hours * hourly_rate_cents)::int
  end as price_share_cents,
  hours
from rule_fallback;

-- ============================================================
-- 5. Done
-- ============================================================
```

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/0004_compound_services.sql
git commit -m "migrate: add service_children table and rewrite allocation view for compounds"
```

---

## Task 2: Apply the migration and regenerate TypeScript types

**Files:**
- Apply: `supabase/migrations/0004_compound_services.sql` → Supabase project `lpgwxacoqiqpcfpkklib`
- Regenerate: `src/types/db.ts`

- [ ] **Step 1: Apply the migration**

Read the migration file contents, then call:

```
mcp__cc-supabase__apply_migration(name: "compound_services", query: "<file contents>")
```

If the MCP tool is unavailable (happened last time — token env var missing), fall back to curl against the Management API:

```bash
SB_TOKEN="$SUPABASE_ACCESS_TOKEN_CC_CALCULATOR"
MIGRATION_SQL="$(cat supabase/migrations/0004_compound_services.sql)"
curl -X POST "https://api.supabase.com/v1/projects/lpgwxacoqiqpcfpkklib/database/migrations" \
  -H "Authorization: Bearer $SB_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg name compound_services --arg query "$MIGRATION_SQL" '{name: $name, query: $query}')"
```

Expected: `{"status": "ok"}` or similar success envelope.

- [ ] **Step 2: Verify the migration with spot-check queries**

Via `mcp__cc-supabase__execute_sql` (or the Management API `POST /v1/projects/{ref}/database/query` endpoint), run each query:

```sql
-- Table exists
select 1 from information_schema.tables where table_schema = 'public' and table_name = 'service_children';

-- Trigger exists
select 1 from pg_trigger where tgname = 'trg_service_children_no_cycle';

-- View exists and returns rows
select count(*) from public.service_allocation_resolved;

-- Cycle trigger rejects self-loop attempt (should error on the check constraint, not the trigger)
-- Don't actually execute; just note the constraint is in place:
select pg_get_constraintdef(oid) from pg_constraint where conname like 'service_children_check%';
```

Each should succeed. The view row count should match what it returned before the migration (services with a rule_id or with a checklist; new service_children table is empty so the new derived branch contributes nothing yet).

- [ ] **Step 3: Regenerate types**

Via MCP:
```
mcp__cc-supabase__generate_typescript_types()
```

Or via curl:
```bash
SB_TOKEN="$SUPABASE_ACCESS_TOKEN_CC_CALCULATOR"
curl -s "https://api.supabase.com/v1/projects/lpgwxacoqiqpcfpkklib/types/typescript?included_schemas=public" \
  -H "Authorization: Bearer $SB_TOKEN" | jq -r '.types' > src/types/db.ts
```

- [ ] **Step 4: Typecheck must pass**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 0 errors. If any existing code references `service_children`, it doesn't yet — so this should just work.

- [ ] **Step 5: Commit**

```bash
git add src/types/db.ts
git commit -m "types: regenerate after compound services migration"
```

---

## Task 3: Build the `useServiceChildren` hook

**Files:**
- Create: `src/hooks/useServiceChildren.ts`

- [ ] **Step 1: Create the hook file**

Create `src/hooks/useServiceChildren.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type ChildRow = Database["public"]["Tables"]["service_children"]["Row"];
type ChildInsert = Database["public"]["Tables"]["service_children"]["Insert"];

const KEY = (parentId: string) => ["service_children", parentId] as const;
const LIST = ["services"] as const;
const MATRIX = ["allocation-matrix"] as const;

export type ServiceChildWithChild = ChildRow & {
  child: {
    id: string;
    name: string;
    code: string | null;
    sell_price_cents: number;
    pricing_model: string;
  };
};

export function useServiceChildren(parentId: string | undefined) {
  return useQuery({
    enabled: !!parentId,
    queryKey: parentId ? KEY(parentId) : ["service_children", "none"],
    queryFn: async (): Promise<ServiceChildWithChild[]> => {
      if (!parentId) return [];
      const { data, error } = await supabase
        .from("service_children")
        .select("*, child:services!service_children_child_id_fkey(id, name, code, sell_price_cents, pricing_model)")
        .eq("parent_id", parentId)
        .order("ordinal");
      if (error) throw error;
      return (data ?? []) as ServiceChildWithChild[];
    },
  });
}

export function useAddServiceChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentId: string; childId: string }) => {
      // Compute next ordinal
      const { data: existing, error: eErr } = await supabase
        .from("service_children")
        .select("ordinal")
        .eq("parent_id", input.parentId)
        .order("ordinal", { ascending: false })
        .limit(1);
      if (eErr) throw eErr;
      const nextOrdinal = existing && existing.length > 0 ? existing[0].ordinal + 1 : 1;

      const row: ChildInsert = {
        parent_id: input.parentId,
        child_id: input.childId,
        ordinal: nextOrdinal,
        quantity: 1,
      };
      const { data, error } = await supabase
        .from("service_children")
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.parentId) });
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: MATRIX });
    },
  });
}

export function useUpdateServiceChildQuantity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentId: string; childId: string; quantity: number }) => {
      const { error } = await supabase
        .from("service_children")
        .update({ quantity: input.quantity })
        .eq("parent_id", input.parentId)
        .eq("child_id", input.childId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.parentId) });
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: MATRIX });
    },
  });
}

export function useRemoveServiceChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentId: string; childId: string }) => {
      const { error } = await supabase
        .from("service_children")
        .delete()
        .eq("parent_id", input.parentId)
        .eq("child_id", input.childId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.parentId) });
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: MATRIX });
    },
  });
}

export function useReorderServiceChildren() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentId: string; orderedChildIds: string[] }) => {
      // Two-phase to avoid the (parent_id, ordinal) uniqueness collision:
      // first bump all ordinals into a high range, then set the target ordinals.
      const BUMP = 100000;
      for (let i = 0; i < input.orderedChildIds.length; i++) {
        const { error } = await supabase
          .from("service_children")
          .update({ ordinal: BUMP + i })
          .eq("parent_id", input.parentId)
          .eq("child_id", input.orderedChildIds[i]);
        if (error) throw error;
      }
      for (let i = 0; i < input.orderedChildIds.length; i++) {
        const { error } = await supabase
          .from("service_children")
          .update({ ordinal: i + 1 })
          .eq("parent_id", input.parentId)
          .eq("child_id", input.orderedChildIds[i]);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.parentId) });
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: MATRIX });
    },
  });
}

/**
 * Returns the set of services that are ancestors of `serviceId` (parents,
 * grandparents, etc.). Used client-side to filter the "Add child" picker so
 * users can't pick a service that would create a cycle. The DB trigger is the
 * real safety net; this is UX.
 */
export function useServiceAncestors(serviceId: string | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: serviceId ? ["service_ancestors", serviceId] : ["service_ancestors", "none"],
    queryFn: async (): Promise<Set<string>> => {
      if (!serviceId) return new Set();
      // Fetch all service_children once and walk locally — the table is small.
      const { data, error } = await supabase.from("service_children").select("parent_id, child_id");
      if (error) throw error;
      const rows = (data ?? []) as { parent_id: string; child_id: string }[];
      const childToParents = new Map<string, string[]>();
      for (const r of rows) {
        const arr = childToParents.get(r.child_id) ?? [];
        arr.push(r.parent_id);
        childToParents.set(r.child_id, arr);
      }
      const ancestors = new Set<string>();
      const stack = [serviceId];
      while (stack.length) {
        const cur = stack.pop()!;
        const parents = childToParents.get(cur) ?? [];
        for (const p of parents) {
          if (!ancestors.has(p)) {
            ancestors.add(p);
            stack.push(p);
          }
        }
      }
      return ancestors;
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 0 errors. (If the foreign-key hint `service_children_child_id_fkey` turns out to have a different name in the generated types, PostgREST will still accept the simpler `child:services!child_id(...)` form — adjust if typecheck complains about the relationship name.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useServiceChildren.ts
git commit -m "feat: useServiceChildren hook for compound-service child CRUD"
```

---

## Task 4: Extend `useAllocationMatrix` to expose `childCounts`

**Files:**
- Modify: `src/hooks/useServices.ts`

- [ ] **Step 1: Edit `AllocationMatrix` type and query**

In `src/hooks/useServices.ts`, change the `AllocationMatrix` type (around line 193) to include `childCounts`:

```ts
export type AllocationMatrix = {
  resolved: Map<string, Map<string, { pct: number | null; hours: number }>>;
  hasChecklist: Set<string>;
  childCounts: Map<string, number>;
};
```

Then update the `useAllocationMatrix` function body. The current Promise.all fetches resolved rows and process_steps service_ids — add a third fetch for `service_children`:

```ts
export function useAllocationMatrix() {
  return useQuery({
    queryKey: MATRIX,
    queryFn: async (): Promise<AllocationMatrix> => {
      const [
        { data: resolvedRows, error: rErr },
        { data: stepRows, error: sErr },
        { data: childRows, error: cErr },
      ] = await Promise.all([
        supabase.from("service_allocation_resolved").select("*"),
        supabase
          .from("process_steps")
          .select("service_id")
          .not("department_id", "is", null)
          .not("estimated_hours", "is", null),
        supabase.from("service_children").select("parent_id"),
      ]);
      if (rErr) throw rErr;
      if (sErr) throw sErr;
      if (cErr) throw cErr;

      const resolved = new Map<string, Map<string, { pct: number | null; hours: number }>>();
      for (const r of (resolvedRows as ResolvedRow[] | null) ?? []) {
        if (!r.service_id || !r.department_id) continue;
        let byDept = resolved.get(r.service_id);
        if (!byDept) {
          byDept = new Map();
          resolved.set(r.service_id, byDept);
        }
        byDept.set(r.department_id, {
          pct: r.pct == null ? null : Number(r.pct),
          hours: Number(r.hours ?? 0),
        });
      }
      const hasChecklist = new Set<string>(
        ((stepRows as { service_id: string }[] | null) ?? []).map((s) => s.service_id)
      );
      const childCounts = new Map<string, number>();
      for (const row of (childRows as { parent_id: string }[] | null) ?? []) {
        childCounts.set(row.parent_id, (childCounts.get(row.parent_id) ?? 0) + 1);
      }
      return { resolved, hasChecklist, childCounts };
    },
  });
}
```

- [ ] **Step 2: Remove the unused `Override` type alias if still present**

Grep for it:

```bash
grep -n "Override" src/hooks/useServices.ts
```

If the alias `type Override = ...` is still defined but unused (the overrides table is gone), remove it. If `useService` still fetches `service_allocation_overrides`, leave it — that's a separate cleanup, not part of this task.

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useServices.ts
git commit -m "feat: allocation matrix exposes childCounts for compound detection"
```

---

## Task 5: Build `ServicePicker` (searchable combobox)

**Files:**
- Create: `src/components/ServicePicker.tsx`

- [ ] **Step 1: Create the file**

Create `src/components/ServicePicker.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useServices } from "@/hooks/useServices";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  /** Service IDs to exclude from results (self + ancestors + already-added children). */
  excludeIds: Set<string>;
  onPick: (serviceId: string) => void;
  placeholder?: string;
}

export function ServicePicker({ excludeIds, onPick, placeholder }: Props) {
  const { data: services = [], isLoading } = useServices();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services
      .filter((s) => !excludeIds.has(s.id))
      .filter((s) => {
        if (!q) return true;
        const hay = `${s.name} ${s.code ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 20);
  }, [services, query, excludeIds]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={placeholder ?? "Search services to add…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
        </div>
      </div>
      {open && !isLoading && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {results.map((s) => (
            <li key={s.id}>
              <Button
                variant="ghost"
                className="w-full justify-start text-left"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus so the click lands before blur fires
                  onPick(s.id);
                  setQuery("");
                }}
              >
                <span className="font-medium">{s.name}</span>
                {s.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{s.code}</span>}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open && !isLoading && results.length === 0 && query.trim() && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-3 text-sm text-muted-foreground shadow-md">
          No matches.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ServicePicker.tsx
git commit -m "feat: ServicePicker searchable combobox for compound child selection"
```

---

## Task 6: Build `IncludedServices` component

**Files:**
- Create: `src/components/IncludedServices.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/IncludedServices.tsx`:

```tsx
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useServiceChildren,
  useAddServiceChild,
  useUpdateServiceChildQuantity,
  useRemoveServiceChild,
  useReorderServiceChildren,
  useServiceAncestors,
} from "@/hooks/useServiceChildren";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ServicePicker } from "@/components/ServicePicker";

interface Props {
  serviceId: string;
}

export function IncludedServices({ serviceId }: Props) {
  const { data: children = [], isLoading } = useServiceChildren(serviceId);
  const { data: ancestors = new Set<string>() } = useServiceAncestors(serviceId);
  const add = useAddServiceChild();
  const updateQty = useUpdateServiceChildQuantity();
  const remove = useRemoveServiceChild();
  const reorder = useReorderServiceChildren();

  const excludeIds = useMemo(() => {
    const s = new Set<string>();
    s.add(serviceId);
    for (const a of ancestors) s.add(a);
    for (const c of children) s.add(c.child_id);
    return s;
  }, [serviceId, ancestors, children]);

  function move(childId: string, direction: -1 | 1) {
    const ordered = children.map((c) => c.child_id);
    const i = ordered.indexOf(childId);
    const j = i + direction;
    if (j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    reorder.mutate(
      { parentId: serviceId, orderedChildIds: ordered },
      { onError: (e: Error) => toast.error(e.message) }
    );
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : children.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          No included services yet. Add one below to make this a bundle.
        </p>
      ) : (
        <ol className="space-y-2">
          {children.map((c, i) => (
            <li key={c.child_id} className="rounded-md border bg-background p-3">
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono text-muted-foreground w-6">{i + 1}</div>
                <div className="flex-1">
                  <Link
                    to={`/services/${c.child_id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {c.child.name}
                  </Link>
                  {c.child.code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{c.child.code}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">×</span>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    className="h-8 w-16 text-right"
                    defaultValue={String(c.quantity)}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
                        toast.error("Quantity must be a positive integer");
                        e.target.value = String(c.quantity);
                        return;
                      }
                      if (n === c.quantity) return;
                      updateQty.mutate(
                        { parentId: serviceId, childId: c.child_id, quantity: n },
                        { onError: (err: Error) => toast.error(err.message) }
                      );
                    }}
                  />
                </div>
                <div className="flex flex-col">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => move(c.child_id, -1)}
                    disabled={i === 0}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => move(c.child_id, 1)}
                    disabled={i === children.length - 1}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    remove.mutate(
                      { parentId: serviceId, childId: c.child_id },
                      { onError: (e: Error) => toast.error(e.message) }
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <ServicePicker
        excludeIds={excludeIds}
        placeholder="Add a service to include…"
        onPick={(childId) =>
          add.mutate(
            { parentId: serviceId, childId },
            {
              onError: (e: Error) => {
                const msg = e.message.includes("cycle")
                  ? "Cannot add — this would create a loop."
                  : e.message;
                toast.error(msg);
              },
            }
          )
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/IncludedServices.tsx
git commit -m "feat: IncludedServices component — add/remove/reorder/quantity"
```

---

## Task 7: Mount `IncludedServices` on `ServiceDetail`

**Files:**
- Modify: `src/pages/ServiceDetail.tsx`

- [ ] **Step 1: Import and render the new card**

In `src/pages/ServiceDetail.tsx`, add the import near the other component imports:

```tsx
import { IncludedServices } from "@/components/IncludedServices";
```

Then, in the right column (currently a single `<Card>` wrapping `<ProcessFlow />` for edit mode, or a placeholder for new mode), **insert a new card above the Process flow card** in edit mode only. Keep the new-mode placeholder unchanged.

Replace the existing edit-mode right column:

```tsx
{mode === "edit" && id ? (
  <Card>
    <CardHeader>
      <CardTitle>Process flow</CardTitle>
    </CardHeader>
    <CardContent>
      <ProcessFlow
        serviceId={id}
        priceCents={form.sell_price_cents}
        pricingModel={form.pricing_model}
        ruleId={form.rule_id}
      />
    </CardContent>
  </Card>
) : ( ... )}
```

with:

```tsx
{mode === "edit" && id ? (
  <>
    <Card>
      <CardHeader>
        <CardTitle>Includes these services</CardTitle>
      </CardHeader>
      <CardContent>
        <IncludedServices serviceId={id} />
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle>Process flow</CardTitle>
      </CardHeader>
      <CardContent>
        <ProcessFlow
          serviceId={id}
          priceCents={form.sell_price_cents}
          pricingModel={form.pricing_model}
          ruleId={form.rule_id}
        />
      </CardContent>
    </Card>
  </>
) : ( ... )}
```

The right column's parent `<div className="space-y-6">` wrapping the process-flow card already handles spacing between the two cards.

- [ ] **Step 2: Typecheck**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ServiceDetail.tsx
git commit -m "feat: mount IncludedServices card on service detail page"
```

---

## Task 8: Make `ProcessFlow` mode-aware for compounds

**Files:**
- Modify: `src/components/ProcessFlow.tsx`

- [ ] **Step 1: Import the children hook**

In `src/components/ProcessFlow.tsx`, add near the other hook imports:

```tsx
import { useServiceChildren } from "@/hooks/useServiceChildren";
```

- [ ] **Step 2: Compute mode flags inside the component**

Just after the existing `const { data: steps = [], isLoading } = useProcessSteps(serviceId);` etc., add:

```tsx
const { data: children = [] } = useServiceChildren(serviceId);
const hasChildren = children.length > 0;
const derived = hasChildren && !hasChecklist;
const overrideOfChildren = hasChildren && hasChecklist;
```

(`hasChecklist` is the existing local computed from `steps`. Keep its current definition.)

- [ ] **Step 3: Update the header copy**

Replace the existing header `<p>` content with a compound-aware version. Find this block:

```tsx
<p className="text-xs text-muted-foreground">
  {hasChecklist
    ? `Custom checklist · ${steps.length} steps. Drives dept allocation.`
    : activeRule
      ? `Using rule: ${activeRule.name}. Seed to customize.`
      : "No rule or checklist. Add steps manually or generate with AI."}
</p>
```

Replace with:

```tsx
<p className="text-xs text-muted-foreground">
  {overrideOfChildren
    ? `Custom checklist overrides ${children.length} included service${children.length === 1 ? "" : "s"}. · ${steps.length} steps.`
    : derived
      ? `Derived from ${children.length} included service${children.length === 1 ? "" : "s"}. Add a checklist to override.`
      : hasChecklist
        ? `Custom checklist · ${steps.length} steps. Drives dept allocation.`
        : activeRule
          ? `Using rule: ${activeRule.name}. Seed to customize.`
          : "No rule or checklist. Add steps manually or generate with AI."}
</p>
```

- [ ] **Step 4: Add a "Seed from children" helper**

Add this function alongside the existing `seedFromRule`:

```tsx
function seedFromChildren() {
  if (!derived) return;
  // Use the resolved view's hours-per-dept for this service (the derived sum).
  // Fetch via supabase directly — keep it local to avoid a new hook.
  (async () => {
    const { data, error } = await supabase
      .from("service_allocation_resolved")
      .select("department_id, hours")
      .eq("service_id", serviceId);
    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = (data ?? [])
      .filter((r) => r.department_id != null && Number(r.hours ?? 0) > 0)
      .map((r, i) => {
        const dept = depts.find((d) => d.id === r.department_id);
        const h = Math.max(0.25, Math.round(Number(r.hours) / 0.25) * 0.25);
        return {
          ordinal: i + 1,
          title: `${dept?.name ?? "Dept"} — work`,
          description: null,
          department_id: r.department_id,
          estimated_hours: h,
          ai_generated: false,
        };
      });
    if (rows.length === 0) {
      toast.error("No derived hours to seed. Do the child services have checklists yet?");
      return;
    }
    replace.mutate(
      { serviceId, steps: rows },
      {
        onSuccess: () => toast.success(`Seeded ${rows.length} steps from included services`),
        onError: (e: Error) => toast.error(e.message),
      }
    );
  })();
}
```

- [ ] **Step 5: Update the toolbar**

Find the toolbar `<div className="flex flex-wrap justify-end gap-2">` containing the action buttons. Adjust the conditionals so that **when `derived` is true**, the `Seed from rule` button is hidden (rule is lower precedence than children), and a new `Seed from children` button is shown instead. Also, when the service has children, hide the `Save as rule` button unless the service is in override mode (there's no single checklist to save when derived).

Replace this block:

```tsx
{!hasChecklist && activeRule && (
  <Button variant="outline" size="sm" onClick={seedFromRule} disabled={replace.isPending}>
    <FileDown className="h-4 w-4" /> Seed from rule
  </Button>
)}
{hasChecklist && !isPercentage && priceCents > 0 && (
  <Button variant="outline" size="sm" onClick={() => setShowSaveAsRule(true)}>
    <Save className="h-4 w-4" /> Save as rule
  </Button>
)}
{hasChecklist && (
  <Button variant="ghost" size="sm" onClick={clearChecklist} disabled={setChecklist.isPending}>
    <RotateCcw className="h-4 w-4" /> Clear checklist
  </Button>
)}
```

with:

```tsx
{derived && (
  <Button variant="outline" size="sm" onClick={seedFromChildren} disabled={replace.isPending}>
    <FileDown className="h-4 w-4" /> Seed from children
  </Button>
)}
{!hasChecklist && !hasChildren && activeRule && (
  <Button variant="outline" size="sm" onClick={seedFromRule} disabled={replace.isPending}>
    <FileDown className="h-4 w-4" /> Seed from rule
  </Button>
)}
{hasChecklist && !isPercentage && priceCents > 0 && !hasChildren && (
  <Button variant="outline" size="sm" onClick={() => setShowSaveAsRule(true)}>
    <Save className="h-4 w-4" /> Save as rule
  </Button>
)}
{overrideOfChildren && (
  <Button variant="ghost" size="sm" onClick={clearChecklist} disabled={setChecklist.isPending}>
    <RotateCcw className="h-4 w-4" /> Revert to derived
  </Button>
)}
{hasChecklist && !hasChildren && (
  <Button variant="ghost" size="sm" onClick={clearChecklist} disabled={setChecklist.isPending}>
    <RotateCcw className="h-4 w-4" /> Clear checklist
  </Button>
)}
```

Note: `clearChecklist`'s confirm dialog message is fine as-is for "Revert to derived" — it says "Delete all steps and fall back to rule allocation?". Tweak the copy to be mode-aware. Find:

```tsx
function clearChecklist() {
  if (!confirm("Delete all steps and fall back to rule allocation?")) return;
```

Replace with:

```tsx
function clearChecklist() {
  const msg = overrideOfChildren
    ? "Delete this checklist and revert to the included services' hours?"
    : "Delete all steps and fall back to rule allocation?";
  if (!confirm(msg)) return;
```

- [ ] **Step 6: Derived-mode body — show only the summary**

The current body renders the step editor. In derived mode there are no steps to edit — we want the summary (which already renders above when `hasChecklist || steps.length > 0`) to render regardless if `derived`. Find the summary render:

```tsx
{(hasChecklist || steps.length > 0) && (
  <ChecklistSummary
    steps={steps}
    departments={depts}
    priceCents={priceCents}
    pricingModel={pricingModel}
  />
)}
```

Change the condition so `ChecklistSummary` also renders in derived mode, but pull the steps from the resolved view there. Simplest: compute synthetic steps from the matrix hook's resolved data.

Add near the other hooks:

```tsx
import { useAllocationMatrix } from "@/hooks/useServices";
```

Then:

```tsx
const { data: matrix } = useAllocationMatrix();
const derivedSteps = useMemo(() => {
  if (!derived || !matrix) return [];
  const byDept = matrix.resolved.get(serviceId);
  if (!byDept) return [];
  let i = 0;
  const out: typeof steps = [];
  for (const [deptId, row] of byDept) {
    const dept = depts.find((d) => d.id === deptId);
    if (!dept) continue;
    if (!(row.hours > 0)) continue;
    i += 1;
    out.push({
      id: `derived-${deptId}`,
      service_id: serviceId,
      ordinal: i,
      title: `${dept.name} — from included services`,
      description: null,
      department_id: deptId,
      estimated_hours: row.hours,
      ai_generated: false,
      created_at: "",
      updated_at: "",
    } as unknown as (typeof steps)[number]);
  }
  return out;
}, [derived, matrix, serviceId, depts]);
```

(Add `import { useMemo } from "react";` next to the existing React import if not already imported.)

Change the summary render condition and data:

```tsx
{(hasChecklist || steps.length > 0 || derived) && (
  <ChecklistSummary
    steps={derived ? derivedSteps : steps}
    departments={depts}
    priceCents={priceCents}
    pricingModel={pricingModel}
  />
)}
```

And change the empty-state / editor body so **derived mode shows nothing in the editor area** (the summary stands in for it):

Replace:

```tsx
{isLoading ? (
  <p className="text-sm text-muted-foreground">Loading…</p>
) : steps.length === 0 ? (
  <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
    No process steps yet. Add one manually, seed from the rule, or let AI draft them.
  </p>
) : (
  <ol className="space-y-2">
    {steps.map((s, i) => ( ... ))}
  </ol>
)}
```

with:

```tsx
{isLoading ? (
  <p className="text-sm text-muted-foreground">Loading…</p>
) : derived ? null : steps.length === 0 ? (
  <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
    {hasChildren
      ? "This bundle is deriving hours from its included services. Use Seed from children to customize."
      : "No process steps yet. Add one manually, seed from the rule, or let AI draft them."}
  </p>
) : (
  <ol className="space-y-2">
    {steps.map((s, i) => ( /* unchanged step editor body */ ))}
  </ol>
)}
```

Leave the step editor body (the `<li>` map) exactly as it is today.

- [ ] **Step 7: Typecheck**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/ProcessFlow.tsx
git commit -m "feat: ProcessFlow mode-aware for compound services (derived/override)"
```

---

## Task 9: Update `ServicesList` grid for compounds

**Files:**
- Modify: `src/pages/ServicesList.tsx`

- [ ] **Step 1: Pull `childCounts` from the matrix**

Find the existing destructure of the matrix query result — something like:

```tsx
const { data: matrix } = useAllocationMatrix();
const hasChecklist = matrix?.hasChecklist ?? new Set<string>();
```

Add:

```tsx
const childCounts = matrix?.childCounts ?? new Map<string, number>();
```

- [ ] **Step 2: Compute `isCompound` and `isDerived` per service**

In the row-rendering loop, for each `service`, compute:

```tsx
const childCount = childCounts.get(service.id) ?? 0;
const isCompound = childCount > 0;
const isDerived = isCompound && !hasChecklist.has(service.id);
```

- [ ] **Step 3: Bundle badge next to service name**

Find the cell that renders the service name (linked to detail page). Add a badge after the name:

```tsx
{isCompound && (
  <Badge variant="secondary" className="ml-2">
    bundle · {childCount}
  </Badge>
)}
```

If `Badge` is already imported in this file, reuse. Otherwise add `import { Badge } from "@/components/ui/badge";` near the top.

- [ ] **Step 4: Rule column shows dash when derived**

Find the rule-name cell rendering. It currently shows the rule name with a muted `(fallback)` suffix when `hasChecklist`. Amend so that **when `isDerived`**, it shows `—` with a tooltip-like muted note:

Find the rule column cell. Replace its inner expression with:

```tsx
{isDerived ? (
  <span className="text-muted-foreground" title="Derived from included services">—</span>
) : hasChecklist.has(service.id) ? (
  <span className="text-muted-foreground/50">
    {service.rule_id ? rulesById.get(service.rule_id)?.name : "—"} <span className="text-xs">(fallback)</span>
  </span>
) : (
  service.rule_id ? rulesById.get(service.rule_id)?.name ?? "—" : "—"
)}
```

(Adapt variable names to whatever the file already uses for looking up rule by id.)

- [ ] **Step 5: Dept cells read-only when compound**

Find where each dept cell decides between read-only and editable. The current logic checks `hasChecklist.has(service.id)`. Change to:

```tsx
const cellReadOnly = hasChecklist.has(service.id) || isCompound;
```

And use `cellReadOnly` everywhere the old flag was referenced in that cell. Update the tooltip text for compound cells: `"Derived from included services — edit in service detail"`.

- [ ] **Step 6: Typecheck**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ServicesList.tsx
git commit -m "feat: ServicesList shows bundle badge and read-only cells for compounds"
```

---

## Task 10: SQL verification + browser smoke test

**Files:** (no source edits; this is the acceptance gate)

- [ ] **Step 1: SQL — table, trigger, and view exist**

Run via `mcp__cc-supabase__execute_sql` (or Management API):

```sql
select count(*) from public.service_children;
-- expect: 0 (initially)

select tgname from pg_trigger where tgname = 'trg_service_children_no_cycle';
-- expect: one row

select count(*) from public.service_allocation_resolved;
-- expect: same order of magnitude as before the migration
```

- [ ] **Step 2: SQL — cycle trigger rejects actual cycles**

```sql
-- Pick any two existing services; call them A and B
-- (use the real UUIDs from your data)
-- Replace :A and :B with real UUIDs before running.

insert into public.service_children (parent_id, child_id, ordinal, quantity)
values (':A', ':B', 1, 1);
-- expect: success

insert into public.service_children (parent_id, child_id, ordinal, quantity)
values (':B', ':A', 1, 1);
-- expect: ERROR "Adding this child would create a cycle in the service tree"

delete from public.service_children where parent_id = ':A' and child_id = ':B';
```

- [ ] **Step 3: SQL — resolved view precedence**

```sql
-- Pick a service S that has a checklist AND we'll add children to it.
-- Before adding children:
select sum(hours) from public.service_allocation_resolved where service_id = ':S';
-- call this BASE

-- Add a child with a checklist of its own
insert into public.service_children (parent_id, child_id, ordinal, quantity)
values (':S', ':CHILD_WITH_CHECKLIST', 1, 1);

-- Expect: BASE unchanged, because S's own checklist takes precedence over children
select sum(hours) from public.service_allocation_resolved where service_id = ':S';

-- Clean up
delete from public.service_children where parent_id = ':S' and child_id = ':CHILD_WITH_CHECKLIST';
```

Then verify derived mode:

```sql
-- Pick a service T that has NO checklist and NO rule (will be 0 hours today)
select sum(hours) from public.service_allocation_resolved where service_id = ':T';
-- expect: 0 or empty

-- Add a child with a 2hr checklist, quantity 2
insert into public.service_children (parent_id, child_id, ordinal, quantity)
values (':T', ':CHILD', 1, 2);

select sum(hours) from public.service_allocation_resolved where service_id = ':T';
-- expect: 2× the child's total hours

delete from public.service_children where parent_id = ':T' and child_id = ':CHILD';
```

- [ ] **Step 4: Browser smoke test**

Start the dev server:

```bash
npm run dev
```

Walk this checklist at `http://localhost:5173/` (or 5174, whichever Vite picks):

1. **Add a child to an existing simple service.** Open any service detail page. In the new "Includes these services" card, type another service's name, click the match. A row appears with quantity 1.
2. **Grid shows bundle badge.** Navigate back to `/services`. The parent row shows `bundle · 1` next to its name. The rule column is a dash. The dept cells are read-only (hover tooltip "Derived from included services — edit in service detail").
3. **Quantity multiplies hours.** Back on the detail page, change quantity to 3. Grid dept cells update (3× the child's hours).
4. **Add a second child.** Badge updates to `bundle · 2`. Dept cells reflect combined sum.
5. **Reorder with arrows.** Swap order; rows re-index; no visible breakage.
6. **Cycle attempt.** Navigate to the child service's detail page. In its "Includes these services" picker, type the parent's name. The parent should **not appear** in the results (ancestor filter). If you were to bypass the UI and POST directly, the trigger would reject it.
7. **Override with own checklist.** Back on the parent detail page, add a step manually (title, dept, 1 hour). Grid updates: dept cells now reflect the override; `bundle · N` badge still shows.
8. **Revert to derived.** Click `Revert to derived`. Checklist is cleared; cells fall back to the sum-of-children.
9. **Delete the parent.** Confirm cascade: child rows in `service_children` are gone, child services themselves still exist.
10. **Restrict on child deletion.** Try to delete a service that's used as a child elsewhere. Expect a clear error (Postgres rejects due to `on delete restrict`).

- [ ] **Step 5: Report results**

If any step fails, note which one and the exact error. Otherwise report: "All 10 smoke-test steps passed."

---

## Self-review

- All seven spec sections (architecture, data model, trigger, view rewrite, UI cards, grid updates, migration + rollout + verification) have at least one task each.
- Types introduced in later tasks (`AllocationMatrix.childCounts`, `ServiceChildWithChild`, derived flags) are defined in earlier tasks before use.
- No placeholder steps — every code step shows the exact code or exact command.
- TDD is light for this plan because the hard logic lives in SQL (tested via the SQL verification queries in Task 10) and the remaining code is plumbing UI to hooks. If tests are desired for any hook, they'd need a Supabase mock — out of scope for V1, consistent with the previous plan's choice.
