# Process Flow Checklist as Allocation Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the process-flow checklist the source of truth for per-service department allocation, collapsing overrides into it and leaving rules as fallback + template.

**Architecture:** One migration rewrites the resolved view to read from `process_steps` first and fall back to `rule_allocations`. Overrides get backfilled into `process_steps`. Frontend renames a hook, makes grid rows read-only when a checklist exists, and upgrades the detail page's Process Flow section with a toolbar (Save as rule, Clear checklist, Seed from rule), a dept/price summary, and a 0.25h minimum.

**Tech Stack:** Supabase Postgres (migrations via `mcp__cc-supabase__apply_migration`), Vite + React 18 + TypeScript, TanStack Query, Tailwind + shadcn/ui, Vitest.

**Spec reference:** [docs/superpowers/specs/2026-04-21-process-flow-checklist-design.md](../specs/2026-04-21-process-flow-checklist-design.md)

---

## File Structure

**Migrations**
- Create: `supabase/migrations/0003_checklist_source_of_truth.sql` — backfills overrides into process_steps, rewrites `service_allocation_resolved`, adds check constraint, drops dead trigger, marks overrides table deprecated

**Hooks**
- Modify: `src/hooks/useServices.ts` — rename `useSetServiceAllocationOverrides` → `useSetServiceChecklist`; reshape `useAllocationMatrix` to return `hasChecklist`
- Modify: `src/hooks/useProcessSteps.ts` — no interface change; `useReplaceSteps` is already the function we need for the detail editor and grid shortcut

**Pages**
- Modify: `src/pages/ServicesList.tsx` — read-only branch for services with a checklist, grid shortcut creates a minimal checklist, badge rename, rule fallback label, revert deletes checklist, remove percentage-service carve-out
- Modify: `src/pages/ServiceDetail.tsx` — remove `AllocationEditor` card entirely; restructure right column around the checklist editor

**Components**
- Modify: `src/components/ProcessFlow.tsx` — enforce 0.25h minimum, add precedence badge, add toolbar actions (Save as rule, Clear checklist, Seed from rule)
- Create: `src/components/ChecklistSummary.tsx` — by-department stacked bar + price-coverage line
- Create: `src/components/SaveAsRuleModal.tsx` — name/description form with collision handling
- Delete: `src/components/AllocationEditor.tsx` — no longer referenced after detail page refactor (keep if used elsewhere; verify with grep)

**Library**
- Modify: `src/lib/allocation.ts` — add `hoursToPct` helper (step-sums per dept → % array for Save as rule)
- Modify: `src/lib/allocation.test.ts` — tests for the new helper

---

## Task 1: Write the migration SQL

**Files:**
- Create: `supabase/migrations/0003_checklist_source_of_truth.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0003_checklist_source_of_truth.sql`:

```sql
-- CC Service Calculator — checklist becomes allocation source of truth
-- Apply via mcp__cc-supabase__apply_migration (name: checklist_source_of_truth)

-- ============================================================
-- 1. Backfill process_steps from service_allocation_overrides
-- ============================================================

insert into public.process_steps (service_id, ordinal, title, description, department_id, estimated_hours, ai_generated)
select
  o.service_id,
  row_number() over (partition by o.service_id order by d.display_order, d.name) as ordinal,
  d.name || ' work' as title,
  null as description,
  o.department_id,
  greatest(0.25, round((o.pct * s.sell_price_cents / d.hourly_rate_cents / 100.0) / 0.25) * 0.25) as estimated_hours,
  false as ai_generated
from public.service_allocation_overrides o
  join public.services s on s.id = o.service_id
  join public.departments d on d.id = o.department_id
where s.sell_price_cents > 0
  and d.hourly_rate_cents > 0
  and not exists (
    -- Skip services that already have a checklist — don't clobber
    select 1 from public.process_steps ps where ps.service_id = o.service_id
  );

-- ============================================================
-- 2. Drop the sum-to-100 trigger on overrides (dead constraint on a deprecated table)
-- ============================================================

drop trigger if exists trg_service_override_sum on public.service_allocation_overrides;
drop function if exists public.tg_service_override_sum_guard();

comment on table public.service_allocation_overrides is
  'Deprecated 2026-04-21 — migrated into process_steps. Safe to drop after one release cycle.';

-- ============================================================
-- 3. Add minimum-hours check on process_steps
-- ============================================================

alter table public.process_steps
  add constraint process_steps_min_hours
  check (estimated_hours is null or estimated_hours >= 0.25);

-- ============================================================
-- 4. Rewrite service_allocation_resolved view
-- ============================================================

create or replace view public.service_allocation_resolved as
with
  -- Step-level sums per (service, department), only when steps have both a dept and hours
  step_sums as (
    select
      ps.service_id,
      ps.department_id,
      sum(ps.estimated_hours) as hours_sum
    from public.process_steps ps
    where ps.department_id is not null
      and ps.estimated_hours is not null
    group by ps.service_id, ps.department_id
  ),
  -- Services that have ANY non-null-dept, non-null-hours steps — these use checklist branch
  services_with_checklist as (
    select distinct service_id from step_sums
  )
select
  ss.service_id,
  ss.department_id,
  case
    when s.sell_price_cents > 0 and d.hourly_rate_cents > 0 then
      round(ss.hours_sum * d.hourly_rate_cents * 100.0 / s.sell_price_cents, 2)
    else null
  end as pct,
  round(ss.hours_sum * d.hourly_rate_cents)::int as price_share_cents,
  ss.hours_sum as hours
from step_sums ss
  join public.services s on s.id = ss.service_id
  join public.departments d on d.id = ss.department_id

union all

-- Fallback: services with no checklist but with a rule_id
select
  s.id as service_id,
  ra.department_id,
  ra.pct,
  round(s.sell_price_cents * ra.pct / 100.0)::int as price_share_cents,
  case
    when d.hourly_rate_cents > 0 then
      round((s.sell_price_cents * ra.pct / 100.0) / d.hourly_rate_cents, 2)
    else 0
  end as hours
from public.services s
  join public.rule_allocations ra on ra.rule_id = s.rule_id
  join public.departments d on d.id = ra.department_id
where s.id not in (select service_id from services_with_checklist);
```

- [ ] **Step 2: Eyeball-check the SQL**

Read through the file and confirm:
- Backfill `insert` has the "not exists" guard so a re-run doesn't clobber manual checklists.
- `process_steps_min_hours` constraint allows null (AI drafts with blank hours) but rejects 0 and positive values under 0.25.
- View's step-sums branch emits `pct = null` for percentage-priced services (`sell_price_cents = 0`) — UI expects this.
- Fallback branch only fires when the service has no step rows — the `not in` guard.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_checklist_source_of_truth.sql
git commit -m "migrate: checklist becomes allocation source of truth

- Backfill process_steps from service_allocation_overrides
- Rewrite service_allocation_resolved view with checklist → rule fallback
- Add min-0.25 check constraint on process_steps
- Drop dead sum-to-100 trigger on overrides
- Mark service_allocation_overrides as deprecated"
```

---

## Task 2: Apply the migration and regenerate types

**Files:**
- Modify: `src/types/db.ts` (regenerated)

- [ ] **Step 1: Apply the migration via MCP**

Use the project-scoped MCP tool:

```
mcp__cc-supabase__apply_migration(
  name: "checklist_source_of_truth",
  query: <full contents of supabase/migrations/0003_checklist_source_of_truth.sql>
)
```

Expected: tool returns success. If it complains about an already-applied migration name, append `_v2` and note in the file's header comment.

- [ ] **Step 2: Verify backfill by counting migrated rows**

```
mcp__cc-supabase__execute_sql(
  query: "select count(*) as services_with_steps from (select distinct service_id from process_steps) t;"
)
```

Record the count. Then:

```
mcp__cc-supabase__execute_sql(
  query: "select count(*) as services_with_overrides from (select distinct service_id from service_allocation_overrides) t;"
)
```

These counts should be equal or the steps count may be higher (if services already had AI-generated steps before migration). If steps < overrides, something went wrong.

- [ ] **Step 3: Spot-check a migrated service**

```
mcp__cc-supabase__execute_sql(
  query: "select s.name, s.sell_price_cents, ps.title, ps.estimated_hours, d.name as dept from process_steps ps join services s on s.id = ps.service_id join departments d on d.id = ps.department_id where s.id in (select service_id from service_allocation_overrides limit 1) order by ps.ordinal;"
)
```

Expected: one row per dept the service had overridden, with title `"{Dept} work"` and hours quarter-rounded ≥ 0.25.

- [ ] **Step 4: Verify the view still works**

```
mcp__cc-supabase__execute_sql(
  query: "select service_id, department_id, pct, hours from service_allocation_resolved limit 20;"
)
```

Expected: mix of rows. Any service with steps returns hours = step sums; any without returns rule-derived values.

- [ ] **Step 5: Regenerate TypeScript types**

```
mcp__cc-supabase__generate_typescript_types()
```

Overwrite `src/types/db.ts` with the returned types. The `service_allocation_resolved` view shape should still have `service_id, department_id, pct, hours` (plus the existing `price_share_cents`). `pct` becomes nullable.

- [ ] **Step 6: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean. If `pct` going nullable breaks `src/hooks/useServices.ts` or other consumers, fix by defaulting to 0 at the read site — but hold off any frontend changes until Task 3.

- [ ] **Step 7: Commit**

```bash
git add src/types/db.ts
git commit -m "chore: regenerate db types after checklist migration"
```

---

## Task 3: Update `useServices.ts` — rename hook, reshape matrix

**Files:**
- Modify: `src/hooks/useServices.ts`

- [ ] **Step 1: Rename mutation hook and reshape input**

In `src/hooks/useServices.ts`, replace the `useSetServiceAllocationOverrides` export with `useSetServiceChecklist`. The new hook accepts one of two shapes:

- `{ kind: "hours", serviceId, hoursByDept }` — grid shortcut; creates minimal steps
- `{ kind: "steps", serviceId, steps }` — detail page editor; exact step set
- `{ kind: "clear", serviceId }` — deletes all steps for the service

Replace the `useSetServiceAllocationOverrides` block starting at line 120 with:

```ts
type ChecklistInput =
  | { kind: "hours"; serviceId: string; hoursByDept: Record<string, number>; departmentOrder: string[] }
  | { kind: "steps"; serviceId: string; steps: {
        ordinal: number;
        title: string;
        description: string | null;
        department_id: string | null;
        estimated_hours: number | null;
        ai_generated: boolean;
      }[] }
  | { kind: "clear"; serviceId: string };

export function useSetServiceChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChecklistInput) => {
      // Always delete existing steps for the service first
      const { error: dErr } = await supabase
        .from("process_steps")
        .delete()
        .eq("service_id", input.serviceId);
      if (dErr) throw dErr;

      if (input.kind === "clear") return;

      if (input.kind === "hours") {
        // Build one step per dept with non-zero hours, in display order
        const rows = input.departmentOrder
          .map((dept_id, i) => ({
            service_id: input.serviceId,
            ordinal: i + 1,
            title: "Department work",
            description: null,
            department_id: dept_id,
            estimated_hours: input.hoursByDept[dept_id] ?? 0,
            ai_generated: false,
          }))
          .filter((r) => (r.estimated_hours ?? 0) >= 0.25);

        if (rows.length === 0) return;

        const { error: iErr } = await supabase.from("process_steps").insert(rows);
        if (iErr) throw iErr;
        return;
      }

      // kind === "steps"
      if (input.steps.length > 0) {
        const { error: iErr } = await supabase
          .from("process_steps")
          .insert(
            input.steps.map((s) => ({
              service_id: input.serviceId,
              ordinal: s.ordinal,
              title: s.title,
              description: s.description,
              department_id: s.department_id,
              estimated_hours: s.estimated_hours,
              ai_generated: s.ai_generated,
            }))
          );
        if (iErr) throw iErr;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: DETAIL(vars.serviceId) });
      qc.invalidateQueries({ queryKey: MATRIX });
      qc.invalidateQueries({ queryKey: ["process_steps", vars.serviceId] });
    },
  });
}
```

- [ ] **Step 2: Reshape `useAllocationMatrix`**

Replace the `AllocationMatrix` type and the body of `useAllocationMatrix` starting at line 152 with:

```ts
export type AllocationMatrix = {
  resolved: Map<string, Map<string, { pct: number | null; hours: number }>>;
  hasChecklist: Set<string>;
};

export function useAllocationMatrix() {
  return useQuery({
    queryKey: MATRIX,
    queryFn: async (): Promise<AllocationMatrix> => {
      const [{ data: resolvedRows, error: rErr }, { data: stepRows, error: sErr }] = await Promise.all([
        supabase.from("service_allocation_resolved").select("*"),
        supabase
          .from("process_steps")
          .select("service_id")
          .not("department_id", "is", null)
          .not("estimated_hours", "is", null),
      ]);
      if (rErr) throw rErr;
      if (sErr) throw sErr;

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
      return { resolved, hasChecklist };
    },
  });
}
```

- [ ] **Step 3: Update imports and exports in place**

Remove the old `useSetServiceAllocationOverrides` name from any exports. Check for references elsewhere:

```bash
grep -rn "useSetServiceAllocationOverrides" src/
```

Expected: hits in `ServicesList.tsx` and `ServiceDetail.tsx`. Those files get updated in later tasks; for now note the hits and move on.

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: errors in `ServicesList.tsx` and `ServiceDetail.tsx` (they still reference the old hook name and the renamed `overridden` → `hasChecklist` field). Those are fixed in Tasks 4 and 11. Don't fix them yet; just confirm the errors are contained to those two files.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useServices.ts
git commit -m "refactor: rename override hook to setServiceChecklist, reshape matrix

useAllocationMatrix now exposes hasChecklist (services with step rows)
and resolved map with nullable pct for percentage-priced services."
```

---

## Task 4: Update `ServicesList.tsx` — read-only rows, badge, percentage integration

**Files:**
- Modify: `src/pages/ServicesList.tsx`

- [ ] **Step 1: Swap imports**

At line 5, replace:

```ts
import { useAllocationMatrix, useServices, useSetServiceAllocationOverrides, type ServiceWithTotals } from "@/hooks/useServices";
```

with:

```ts
import { useAllocationMatrix, useServices, useSetServiceChecklist, type ServiceWithTotals } from "@/hooks/useServices";
```

- [ ] **Step 2: Update `<ServiceRow>` props and matrix consumers**

At line 105, update the `<ServiceRow>` call:

```tsx
<ServiceRow
  key={s.id}
  service={s}
  departments={depts}
  ruleName={s.rule_id ? ruleMap.get(s.rule_id)?.name ?? "—" : null}
  resolvedByDept={matrix?.resolved.get(s.id)}
  hasChecklist={matrix?.hasChecklist.has(s.id) ?? false}
/>
```

At line 131, update the `ServiceRow` signature:

```tsx
function ServiceRow({
  service,
  departments,
  ruleName,
  resolvedByDept,
  hasChecklist,
}: {
  service: ServiceWithTotals;
  departments: Department[];
  ruleName: string | null;
  resolvedByDept: Map<string, { pct: number | null; hours: number }> | undefined;
  hasChecklist: boolean;
}) {
```

- [ ] **Step 3: Replace `useSetServiceAllocationOverrides`**

Inside `ServiceRow`, at line 138:

```tsx
const setChecklist = useSetServiceChecklist();
```

And update the `isOverridden` variable's usages — rename `isOverridden` to `hasChecklist` throughout the function body. Cell-level `inherited` logic at line 231 becomes:

```tsx
const inherited = !hasChecklist && !touched.has(d.id);
```

- [ ] **Step 4: Make dept cells read-only when `hasChecklist`**

Replace the cell render at lines 232-252:

```tsx
{departments.map((d) => {
  const inherited = !hasChecklist && !touched.has(d.id);
  const value = hours[d.id] ?? 0;
  if (hasChecklist) {
    return (
      <td key={d.id} className={cn("px-2 py-2 text-right tabular-nums", cellBorder)}>
        <Link
          to={`/services/${service.id}`}
          className="text-sm text-muted-foreground hover:underline"
          title="Edit in service detail"
        >
          {value > 0 ? formatHours(value) : "—"}
        </Link>
      </td>
    );
  }
  return (
    <td key={d.id} className={cn("px-2 py-2 text-right", cellBorder)}>
      <input
        type="number"
        step="0.25"
        min={0}
        value={value}
        onChange={(e) => updateCell(d.id, e.target.value)}
        className={cn(
          "h-7 w-[72px] rounded border border-transparent bg-transparent px-1 text-right text-sm tabular-nums",
          "focus:border-ring focus:bg-background focus:outline-none",
          inherited ? "italic text-muted-foreground" : "font-medium text-foreground",
          touched.has(d.id) && "border-amber-300 bg-amber-50"
        )}
      />
    </td>
  );
})}
```

The existing `isPercentage` carve-out (lines 232-234) is deleted — percentage services now render the same way as everyone else.

- [ ] **Step 5: Delete the pricing-specific badge branch**

At line 269, the existing code renders a status badge when `isPercentage`:

```tsx
{isPercentage ? (
  <Badge variant={service.status === "active" ? "success" : "secondary"}>{service.status}</Badge>
) : dirty ? ( ... )}
```

Remove the `isPercentage ?` branch entirely. The action cell becomes:

```tsx
<td className={cn("px-3 py-2", cellBorder)}>
  {dirty ? (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={reset} disabled={setChecklist.isPending}>
        Cancel
      </Button>
      <Button size="sm" onClick={save} disabled={!sumValid || setChecklist.isPending}>
        Save
      </Button>
    </div>
  ) : hasChecklist ? (
    <Button size="sm" variant="ghost" onClick={revert} disabled={setChecklist.isPending} title="Delete checklist and fall back to rule">
      <RotateCcw className="h-3.5 w-3.5" /> Revert
    </Button>
  ) : (
    <Badge variant={service.status === "active" ? "success" : "secondary"}>{service.status}</Badge>
  )}
</td>
```

Also remove the Total-cell percentage branch at lines 254-260 — the total cell always sums `hours` now:

```tsx
<td className={cn("px-3 py-2 text-right tabular-nums", cellBorder)}>
  <span className={cn("font-medium", dirty && !sumValid && "text-destructive")}>
    {formatHours(sumHours)}
  </span>
  {dirty && !isPercentage && (
    <div className={cn("text-[10px]", sumValid ? "text-muted-foreground" : "text-destructive")}>
      {sumPct.toFixed(1)}%
    </div>
  )}
</td>
```

(Keep the `!isPercentage` guard on the sub-line — percentage services have no price-based pct to show, but the total hours still renders.)

The `isPercentage` variable at line 137 stays because it's still used for the tally sub-line. It no longer gates the cell rendering.

- [ ] **Step 6: Rename the "override" badge to "checklist"**

At line 220, replace:

```tsx
{isOverridden && !dirty && (
  <Badge variant="outline" className="ml-2 text-[10px]">override</Badge>
)}
```

with:

```tsx
{hasChecklist && !dirty && (
  <Badge variant="outline" className="ml-2 text-[10px]">checklist</Badge>
)}
```

- [ ] **Step 7: Grey out rule name when checklist is active**

At line 224, replace:

```tsx
<td className={cn("px-3 py-2 text-muted-foreground max-w-[160px] truncate", cellBorder)} title={ruleName ?? undefined}>
  {ruleName ?? <Badge variant="outline">custom</Badge>}
</td>
```

with:

```tsx
<td
  className={cn(
    "px-3 py-2 max-w-[160px] truncate",
    hasChecklist ? "text-muted-foreground/50" : "text-muted-foreground",
    cellBorder
  )}
  title={ruleName ? (hasChecklist ? `${ruleName} (fallback — checklist is driving allocation)` : ruleName) : undefined}
>
  {ruleName ? (
    <>
      {ruleName}
      {hasChecklist && <span className="ml-1 text-[10px]">(fallback)</span>}
    </>
  ) : (
    <Badge variant="outline">custom</Badge>
  )}
</td>
```

- [ ] **Step 8: Update `save()` and `revert()` to use the new mutation**

Replace the `save` and `revert` functions (lines 184-209):

```tsx
function save() {
  const hoursByDept: Record<string, number> = {};
  for (const d of departments) {
    const h = hours[d.id] ?? 0;
    if (h >= 0.25) hoursByDept[d.id] = h;
  }
  if (Object.keys(hoursByDept).length === 0) {
    toast.error("Enter at least 0.25 hours on one department");
    return;
  }
  setChecklist.mutate(
    {
      kind: "hours",
      serviceId: service.id,
      hoursByDept,
      departmentOrder: departments.map((d) => d.id),
    },
    {
      onSuccess: () => {
        setTouched(new Set());
        toast.success(`Saved as checklist for ${service.name}. Edit steps on detail page.`);
      },
      onError: (e) => toast.error(e.message),
    }
  );
}

function revert() {
  if (!confirm(`Delete the checklist for ${service.name} and fall back to its rule's allocation?`)) return;
  setChecklist.mutate(
    { kind: "clear", serviceId: service.id },
    {
      onSuccess: () => toast.success(`Reverted ${service.name} to rule`),
      onError: (e) => toast.error(e.message),
    }
  );
}
```

- [ ] **Step 9: Drop the `sumValid` gate for percentage services**

The existing `sumValid` check (line 182) uses `SUM_TOLERANCE_MIN/MAX` which assumes a %-to-100 model. In the new world, a service can have hours that don't sum to "100%" of price — that's fine, overage just shows amber on the detail page. For the grid save path, drop the `sumValid` requirement:

Replace line 182:

```tsx
const sumValid = true; // Checklist hours aren't constrained to price; overage is shown as info on detail page.
```

And remove the `SUM_TOLERANCE_MIN`/`SUM_TOLERANCE_MAX` import at line 13 if unused elsewhere:

```bash
grep -n "SUM_TOLERANCE" src/pages/ServicesList.tsx
```

If the only hits are the import and the replaced `sumValid` line, delete the import.

- [ ] **Step 10: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: errors remaining only in `ServiceDetail.tsx`.

- [ ] **Step 11: Commit**

```bash
git add src/pages/ServicesList.tsx
git commit -m "ServicesList: read-only rows for checklist services, rename badge, integrate percentage services

- Rows in hasChecklist: dept cells become links to detail page
- Rows without checklist: grid shortcut creates minimal checklist on save
- override badge → checklist; rule name greys out with (fallback) suffix
- percentage services no longer excluded from the grid
- Revert deletes checklist rather than override rows"
```

---

## Task 5: Add `hoursToPct` helper with tests

**Files:**
- Modify: `src/lib/allocation.ts`
- Modify: `src/lib/allocation.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/allocation.test.ts`:

```ts
import { hoursToPct } from "./allocation";

describe("hoursToPct", () => {
  it("converts hours-per-dept to % using dept rates and total price", () => {
    // Service price R3,300 (330000 cents).
    // Dev 1.84h @ R1,075/hr (107500 cents) = 197800 cents = 59.94%
    // SEO 0.77h @ R1,075/hr = 82775 cents = 25.08%
    // PM 0.43h @ R1,150/hr (115000 cents) = 49450 cents = 14.98%
    const result = hoursToPct({
      hoursByDept: { dev: 1.84, seo: 0.77, pm: 0.43 },
      departmentRates: { dev: 107500, seo: 107500, pm: 115000 },
      priceCents: 330000,
    });
    expect(result.dev).toBeCloseTo(59.94, 1);
    expect(result.seo).toBeCloseTo(25.08, 1);
    expect(result.pm).toBeCloseTo(14.98, 1);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 0); // within a rounding %
  });

  it("skips depts with zero hours", () => {
    const result = hoursToPct({
      hoursByDept: { dev: 1, seo: 0, pm: 0 },
      departmentRates: { dev: 100000, seo: 100000, pm: 100000 },
      priceCents: 100000,
    });
    expect(result).toEqual({ dev: 100 });
  });

  it("returns empty object when priceCents is 0", () => {
    const result = hoursToPct({
      hoursByDept: { dev: 1 },
      departmentRates: { dev: 100000 },
      priceCents: 0,
    });
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/allocation.test.ts
```

Expected: FAIL with "hoursToPct is not a function" or import error.

- [ ] **Step 3: Implement `hoursToPct`**

Append to `src/lib/allocation.ts`:

```ts
/**
 * Convert a per-department hours map into a per-department % map,
 * using each dept's hourly rate and the service's sell price.
 * pct_dept = hours_dept * rate_dept / price * 100
 *
 * Returns empty object if priceCents <= 0 (percentage-priced services).
 * Skips depts with zero or negative hours.
 */
export function hoursToPct(input: {
  hoursByDept: Record<string, number>;
  departmentRates: Record<string, number>; // hourly_rate_cents
  priceCents: number;
}): Record<string, number> {
  if (input.priceCents <= 0) return {};
  const out: Record<string, number> = {};
  for (const [deptId, hours] of Object.entries(input.hoursByDept)) {
    if (hours <= 0) continue;
    const rate = input.departmentRates[deptId] ?? 0;
    if (rate <= 0) continue;
    out[deptId] = Math.round(((hours * rate) / input.priceCents) * 100 * 100) / 100;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/allocation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/allocation.ts src/lib/allocation.test.ts
git commit -m "allocation: add hoursToPct helper for Save as rule

Pure function converting dept-hour map into % map using dept rates
and service price. Used by the Save-as-rule modal."
```

---

## Task 6: Build the `ChecklistSummary` component

**Files:**
- Create: `src/components/ChecklistSummary.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/ChecklistSummary.tsx`:

```tsx
import { useMemo } from "react";
import { cn, formatHours, formatZar } from "@/lib/utils";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];
type Step = Database["public"]["Tables"]["process_steps"]["Row"];

interface Props {
  steps: Step[];
  departments: Department[];
  priceCents: number;
  pricingModel: string;
}

export function ChecklistSummary({ steps, departments, priceCents, pricingModel }: Props) {
  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  const { totals, totalHours, planCents } = useMemo(() => {
    const totals = new Map<string, number>();
    let totalHours = 0;
    let planCents = 0;
    for (const s of steps) {
      if (!s.department_id || s.estimated_hours == null) continue;
      const h = Number(s.estimated_hours);
      totalHours += h;
      totals.set(s.department_id, (totals.get(s.department_id) ?? 0) + h);
      const rate = deptMap.get(s.department_id)?.hourly_rate_cents ?? 0;
      planCents += h * rate;
    }
    return { totals, totalHours, planCents };
  }, [steps, deptMap]);

  if (totals.size === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Add at least one step with a department and hours to see the summary.
      </div>
    );
  }

  const entries = Array.from(totals.entries())
    .map(([deptId, hours]) => ({
      dept: deptMap.get(deptId),
      hours,
    }))
    .filter((e) => e.dept != null)
    .sort((a, b) => (a.dept!.display_order ?? 0) - (b.dept!.display_order ?? 0));

  const coveragePct = priceCents > 0 ? (planCents / priceCents) * 100 : 0;
  const isPercentage = pricingModel === "percentage";

  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
        {entries.map((e) => {
          const widthPct = totalHours > 0 ? (e.hours / totalHours) * 100 : 0;
          return (
            <div
              key={e.dept!.id}
              className="h-full"
              style={{
                width: `${widthPct}%`,
                backgroundColor: e.dept!.color ?? "#64748b",
              }}
              title={`${e.dept!.name}: ${formatHours(e.hours)}`}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {entries.map((e) => (
          <span key={e.dept!.id} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.dept!.color ?? "#64748b" }} />
            {e.dept!.name}: {formatHours(e.hours)}
          </span>
        ))}
        <span className="ml-auto font-medium text-foreground">Total {formatHours(totalHours)}</span>
      </div>

      {!isPercentage && priceCents > 0 && (
        <div
          className={cn(
            "text-xs",
            coveragePct > 110 && "text-destructive",
            coveragePct > 100 && coveragePct <= 110 && "text-amber-600",
            coveragePct <= 100 && "text-muted-foreground"
          )}
        >
          Budget: {formatZar(priceCents)}. Planned: {formatZar(Math.round(planCents))} ({coveragePct.toFixed(0)}%).
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors in this file. The `db.ts` types already include `process_steps` rows.

- [ ] **Step 3: Commit**

```bash
git add src/components/ChecklistSummary.tsx
git commit -m "feat(components): ChecklistSummary — by-dept bar + price coverage line"
```

---

## Task 7: Build the `SaveAsRuleModal` component

**Files:**
- Create: `src/components/SaveAsRuleModal.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/SaveAsRuleModal.tsx`:

```tsx
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { hoursToPct } from "@/lib/allocation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];
type Step = Database["public"]["Tables"]["process_steps"]["Row"];

interface Props {
  open: boolean;
  onClose: () => void;
  steps: Step[];
  departments: Department[];
  priceCents: number;
  onSaved: () => void;
}

export function SaveAsRuleModal({ open, onClose, steps, departments, priceCents, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [collision, setCollision] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);

  const pcts = useMemo(() => {
    const hoursByDept: Record<string, number> = {};
    for (const s of steps) {
      if (!s.department_id || s.estimated_hours == null) continue;
      hoursByDept[s.department_id] = (hoursByDept[s.department_id] ?? 0) + Number(s.estimated_hours);
    }
    const rates = Object.fromEntries(departments.map((d) => [d.id, d.hourly_rate_cents]));
    return hoursToPct({ hoursByDept, departmentRates: rates, priceCents });
  }, [steps, departments, priceCents]);

  const deptsById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  async function save(mode: "new" | "overwrite") {
    if (!name.trim()) return;
    setBusy(true);
    try {
      let ruleId: string | null = null;

      if (mode === "overwrite") {
        const { data: existing, error: fErr } = await supabase
          .from("rules").select("id").eq("name", name.trim()).maybeSingle();
        if (fErr) throw fErr;
        if (!existing) throw new Error("Rule vanished");
        ruleId = existing.id;

        // Replace allocations
        const { error: dErr } = await supabase
          .from("rule_allocations").delete().eq("rule_id", ruleId);
        if (dErr) throw dErr;

        // Update description
        const { error: uErr } = await supabase
          .from("rules").update({ description: description.trim() || null }).eq("id", ruleId);
        if (uErr) throw uErr;
      } else {
        // Create new — handles both new-name and user-picked-different-name-after-collision
        const { data: created, error: cErr } = await supabase
          .from("rules")
          .insert({ name: name.trim(), description: description.trim() || null })
          .select()
          .single();
        if (cErr) {
          if (cErr.code === "23505") {
            // unique violation — name collided
            setCollision(name.trim());
            return;
          }
          throw cErr;
        }
        ruleId = created.id;
      }

      // Insert allocations
      const rows = Object.entries(pcts).map(([dept_id, pct]) => ({
        rule_id: ruleId!,
        department_id: dept_id,
        pct,
      }));
      if (rows.length > 0) {
        const { error: iErr } = await supabase.from("rule_allocations").insert(rows);
        if (iErr) throw iErr;
      }

      toast.success(`Rule "${name.trim()}" saved`);
      onSaved();
      onClose();
      setName("");
      setDescription("");
      setCollision(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rule");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-md bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Save checklist as rule</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Converts the checklist's dept totals into a reusable rule. This service keeps its
          checklist — the rule is available for other services to use.
        </p>

        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setCollision(null); }}
              placeholder="e.g. Dev-heavy SEO"
            />
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1 rounded border p-3 text-xs">
            <div className="font-medium">Preview</div>
            {Object.entries(pcts).map(([dept_id, pct]) => (
              <div key={dept_id} className="flex justify-between">
                <span>{deptsById.get(dept_id)?.name ?? "Unknown"}</span>
                <span className="tabular-nums">{pct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>

        {collision && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            A rule named <span className="font-medium">{collision}</span> already exists.
            Overwrite its allocations, or choose a different name.
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          {collision ? (
            <>
              <Button variant="outline" onClick={() => save("overwrite")} disabled={busy}>Overwrite</Button>
              <Button onClick={() => setCollision(null)} disabled={busy}>Edit name</Button>
            </>
          ) : (
            <Button onClick={() => save("new")} disabled={busy || !name.trim()}>Save rule</Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean in this file; errors still pending in `ServiceDetail.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/SaveAsRuleModal.tsx
git commit -m "feat(components): SaveAsRuleModal — name/description + preview + collision handling"
```

---

## Task 8: Enhance `ProcessFlow.tsx` — min-hours, toolbar actions, precedence badge, seed from rule

**Files:**
- Modify: `src/components/ProcessFlow.tsx`

- [ ] **Step 1: Expand the props interface and imports**

Replace the imports at lines 1-9:

```tsx
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2, Save, RotateCcw, FileDown } from "lucide-react";
import { toast } from "sonner";
import { useProcessSteps, useReplaceSteps, useUpdateStep, useDeleteStep, useCreateStep } from "@/hooks/useProcessSteps";
import { useDepartments } from "@/hooks/useDepartments";
import { useRules } from "@/hooks/useRules";
import { useSetServiceChecklist } from "@/hooks/useServices";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChecklistSummary } from "@/components/ChecklistSummary";
import { SaveAsRuleModal } from "@/components/SaveAsRuleModal";
import { supabase } from "@/lib/supabase";
```

Replace the `Props` interface at line 11:

```tsx
interface Props {
  serviceId: string;
  priceCents: number;
  pricingModel: string;
  ruleId: string | null;
}
```

- [ ] **Step 2: Pull in rules data and add modal state**

Inside `ProcessFlow`, at the top of the function body (line 16), replace the hook calls:

```tsx
const { data: steps = [], isLoading } = useProcessSteps(serviceId);
const { data: depts = [] } = useDepartments();
const { data: rules = [] } = useRules();
const update = useUpdateStep();
const remove = useDeleteStep();
const create = useCreateStep();
const replace = useReplaceSteps();
const setChecklist = useSetServiceChecklist();
const [aiLoading, setAiLoading] = useState(false);
const [showSaveAsRule, setShowSaveAsRule] = useState(false);

const activeRule = rules.find((r) => r.id === ruleId);
const hasChecklist = steps.some((s) => s.department_id && s.estimated_hours != null);
const isPercentage = pricingModel === "percentage";
```

- [ ] **Step 3: Add "Seed from rule" action**

Add this function inside the component, after `addStep` (line 74):

```tsx
function seedFromRule() {
  if (!activeRule || !activeRule.allocations) return;
  if (steps.length > 0 && !confirm("Replace current steps with rule-seeded defaults?")) return;
  const rows = activeRule.allocations
    .filter((a) => Number(a.pct) > 0)
    .map((a, i) => {
      const dept = depts.find((d) => d.id === a.department_id);
      const rate = dept?.hourly_rate_cents ?? 0;
      let hours = rate > 0 && priceCents > 0
        ? (Number(a.pct) * priceCents) / rate / 100
        : 0.25;
      hours = Math.max(0.25, Math.round(hours / 0.25) * 0.25);
      return {
        ordinal: i + 1,
        title: `${dept?.name ?? "Dept"} — work`,
        description: null,
        department_id: a.department_id,
        estimated_hours: hours,
        ai_generated: false,
      };
    });
  replace.mutate(
    { serviceId, steps: rows },
    {
      onSuccess: () => toast.success(`Seeded ${rows.length} steps from "${activeRule.name}"`),
      onError: (e) => toast.error(e.message),
    }
  );
}

function clearChecklist() {
  if (!confirm("Delete all steps and fall back to rule allocation?")) return;
  setChecklist.mutate(
    { kind: "clear", serviceId },
    {
      onSuccess: () => toast.success("Checklist cleared; service is now using its rule."),
      onError: (e) => toast.error(e.message),
    }
  );
}
```

- [ ] **Step 4: Enforce 0.25h minimum client-side**

Find the hours input at line 136-147 (in the current file; line numbers shift with additions) and update the `onBlur`:

```tsx
<Input
  type="number"
  step="0.25"
  min="0.25"
  className="h-8 w-24"
  placeholder="hours"
  defaultValue={s.estimated_hours != null ? String(s.estimated_hours) : ""}
  onBlur={(e) => {
    const raw = e.target.value.trim();
    if (raw === "") {
      update.mutate({ id: s.id, patch: { estimated_hours: null } });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0.25) {
      toast.error("Step hours must be at least 0.25");
      e.target.value = s.estimated_hours != null ? String(s.estimated_hours) : "";
      return;
    }
    const rounded = Math.round(n / 0.25) * 0.25;
    e.target.value = String(rounded);
    update.mutate({ id: s.id, patch: { estimated_hours: rounded } });
  }}
/>
```

- [ ] **Step 5: Expand the toolbar**

Replace the existing header/toolbar block at lines 78-91:

```tsx
<div className="space-y-3">
  <div className="flex items-center justify-between gap-3">
    <div>
      <h3 className="text-sm font-semibold">Process flow</h3>
      <p className="text-xs text-muted-foreground">
        {hasChecklist
          ? `Custom checklist · ${steps.length} steps. Drives dept allocation.`
          : activeRule
            ? `Using rule: ${activeRule.name}. Seed to customize.`
            : "No rule or checklist. Add steps manually or generate with AI."}
      </p>
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" size="sm" onClick={generateAI} disabled={aiLoading}>
        <Sparkles className="h-4 w-4" /> {aiLoading ? "Generating…" : "Generate with AI"}
      </Button>
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
      <Button variant="outline" size="sm" onClick={addStep}>
        <Plus className="h-4 w-4" /> Add step
      </Button>
    </div>
  </div>

  {(hasChecklist || steps.length > 0) && (
    <ChecklistSummary
      steps={steps}
      departments={depts}
      priceCents={priceCents}
      pricingModel={pricingModel}
    />
  )}
```

(Leave the existing empty-state and step list below — they already handle the list render.)

- [ ] **Step 6: Close the outer `<div>`**

Change the wrapping `<div className="space-y-4">` at line 77 to keep consistent — but since Step 5 introduced a new wrapper `<div className="space-y-3">`, ensure the outer JSX element now closes correctly. The full updated shape:

```tsx
return (
  <div className="space-y-4">
    <div className="space-y-3">
      {/* toolbar + summary (from Step 5) */}
    </div>

    {isLoading ? (
      <p className="text-sm text-muted-foreground">Loading…</p>
    ) : steps.length === 0 ? (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No process steps yet. Add one manually, seed from the rule, or let AI draft them.
      </p>
    ) : (
      <ol className="space-y-2">
        {/* existing step list — unchanged */}
      </ol>
    )}

    <SaveAsRuleModal
      open={showSaveAsRule}
      onClose={() => setShowSaveAsRule(false)}
      steps={steps}
      departments={depts}
      priceCents={priceCents}
      onSaved={() => { /* no-op; rules invalidate on their own */ }}
    />
  </div>
);
```

- [ ] **Step 7: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean in `ProcessFlow.tsx`. Errors still remaining in `ServiceDetail.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/components/ProcessFlow.tsx
git commit -m "ProcessFlow: toolbar actions, summary, seed-from-rule, min 0.25h

- Precedence badge text in the header
- Save as rule (opens modal), Clear checklist, Seed from rule buttons
- Client-side 0.25h min on step hours input
- ChecklistSummary below the header for live dept bar + price coverage"
```

---

## Task 9: Update `ServiceDetail.tsx` — drop AllocationEditor, wire ProcessFlow

**Files:**
- Modify: `src/pages/ServiceDetail.tsx`

- [ ] **Step 1: Remove allocation-related imports and state**

At the top of the file, replace lines 1-17:

```tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCreateService, useDeleteService, useService, useUpdateService } from "@/hooks/useServices";
import { useRules } from "@/hooks/useRules";
import { useTeam } from "@/hooks/useTeam";
import { ProcessFlow } from "@/components/ProcessFlow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatZar } from "@/lib/utils";
```

Notice: `useDepartments`, `AllocationEditor`, `useSetServiceAllocationOverrides`, `isSumValid`, `useMemo`, `Badge`, `CardDescription`, `formatHours` — all removed. If any remain referenced, fix in the next step.

- [ ] **Step 2: Remove override state and handler**

Inside `ServiceDetail`, delete:
- `const setOverrides = useSetServiceAllocationOverrides();` (current line 33)
- `const [overrides, setOverrideRows] = useState<AllocRow[] | null>(null);` (current line 51)
- The `setOverrideRows(...)` call inside the `useEffect` (around lines 72-76)
- The `hasOverrides` and `allocations` memos (current lines 81-84)
- `saveOverrides` function (current lines 123-136)

- [ ] **Step 3: Replace the right-column Allocation card with ProcessFlow-only layout**

Replace the entire right column (lines 279-326) with:

```tsx
<div className="space-y-6">
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
  ) : (
    <Card>
      <CardHeader>
        <CardTitle>Process flow</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Save the service first, then add process steps here.
        </p>
      </CardContent>
    </Card>
  )}
</div>
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: CLEAN. If not, the remaining errors will be unused imports — remove them.

- [ ] **Step 5: Verify AllocationEditor isn't used elsewhere**

```bash
grep -rn "AllocationEditor" src/
```

Expected: no hits after ServiceDetail.tsx was updated. If no hits, delete the file:

```bash
rm src/components/AllocationEditor.tsx
```

Also check `useSetServiceAllocationOverrides`:

```bash
grep -rn "useSetServiceAllocationOverrides" src/
```

Expected: no hits.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "ServiceDetail: remove AllocationEditor card, ProcessFlow drives allocation

Right column is now just the Process flow section. Old %-based
override editor is deleted; the checklist replaces it."
```

---

## Task 10: Smoke test and verification

**Files:** none (manual verification)

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Expected: Vite serves at `http://localhost:5173` or `5174`.

- [ ] **Step 2: Log in and check `/services` grid**

Verify:
- Grid renders all ~140 services with department columns and hours.
- Services previously with overrides show a `checklist` badge next to the name.
- Services on rule fallback show no badge; their Rule column text is at full opacity.
- Services with a checklist show their Rule column text at reduced opacity with `(fallback)` suffix.
- Percentage services now show hours in dept cells (previously `—`) if they have a checklist, else `—` across the row but no longer the entire Total cell showing dash when they have steps.
- Hovering a cell on a checklist row shows `Edit in service detail` tooltip; clicking navigates to the service's detail page.
- Editing a cell on a non-checklist service shows the Cancel/Save buttons; Save writes a checklist (the badge flips to `checklist` on next render).
- Revert on a checklist row confirms, then deletes steps and returns the row to rule fallback.

- [ ] **Step 3: Open a service detail page**

Pick a service that was on rule fallback (no `checklist` badge). Verify:
- Right column shows "Process flow" card.
- Precedence badge reads `Using rule: {name}. Seed to customize.`
- "Seed from rule" button is visible.
- Click "Seed from rule" → confirms, creates one step per dept in the rule, hours rounded to 0.25.
- Badge flips to `Custom checklist · N steps. Drives dept allocation.`
- ChecklistSummary shows dept bar with colored segments and dept: hours text.
- Price coverage line shows `Budget: RXXX. Planned: RYYY (NN%).`
- "Save as rule" and "Clear checklist" buttons appear.

- [ ] **Step 4: Test Save as rule**

- Click "Save as rule" → modal opens with name/desc fields and a preview of % per dept.
- Preview % sum should be ≈100%.
- Enter a new name, click Save rule → toast success, modal closes, current service's checklist is still intact.
- Open `/rules` and verify the new rule exists with the correct % per dept.
- Retry with a colliding name → collision banner appears, Overwrite button works.

- [ ] **Step 5: Test AI generate**

- On a service without a checklist, click "Generate with AI" (requires ANTHROPIC_API_KEY secret set in Supabase).
- Confirm the generated steps appear as rows.
- Edit one step's title and hours on blur — updates persist (refresh to confirm).

- [ ] **Step 6: Test percentage service**

- Navigate to a percentage-priced service. Verify:
- Price Coverage line in ChecklistSummary does NOT appear (the budget check is hidden for `pricing_model = 'percentage'`).
- "Save as rule" button is NOT shown.
- Add a manual step with Dev @ 2h. Navigate back to `/services`. Row shows 2h in Dev column and `2h` in Total; badge is `checklist`.

- [ ] **Step 7: Test client-side min 0.25**

- On a step, set hours to `0.1` and blur. Expect toast error: "Step hours must be at least 0.25" and the field reverts to its previous value.
- Set to `0.13` → rounds to 0.25 on blur.
- Set to `0.38` → rounds to 0.5.

- [ ] **Step 8: Verify migration data integrity**

Run this SQL via MCP to spot-check hours parity:

```
mcp__cc-supabase__execute_sql(
  query: "select service_id, sum(hours) as total_hours from service_allocation_resolved group by service_id order by random() limit 10;"
)
```

Ensure each row's `total_hours` is a plausible small number (0.25–20h range).

- [ ] **Step 9: If all smoke tests pass, mark done**

No code change; just a checkbox.

---

## Self-review notes

**Spec coverage check:**
- Migration with backfill, view rewrite, constraint, trigger drop: Task 1 ✓
- Type regen: Task 2 ✓
- Hook rename + matrix reshape: Task 3 ✓
- Grid read-only + badge + percentage integration + revert copy: Task 4 ✓
- `hoursToPct` helper + tests: Task 5 ✓
- ChecklistSummary by-dept + price coverage: Task 6 ✓
- SaveAsRuleModal with collision: Task 7 ✓
- ProcessFlow toolbar, seed, min-0.25, precedence badge, clear: Task 8 ✓
- ServiceDetail drops AllocationEditor, wires ProcessFlow with context: Task 9 ✓
- Smoke verification: Task 10 ✓

**Deliberate deferrals (match spec's non-goals):**
- Drag-to-reorder: existing up/down arrows stay; no change.
- Step dependencies, per-step assignees, bulk seed-all: not in this plan.
- Dropping `service_allocation_overrides` table: stays with a deprecated comment; drop later.
