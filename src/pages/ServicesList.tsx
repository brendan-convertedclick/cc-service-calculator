import { memo, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { useServices, type ServiceWithTotals } from "@/hooks/useServices";
import { useSetServiceChecklist } from "@/hooks/useProcessSteps";
import { useAllocationMatrix, type AllocationMatrix } from "@/hooks/useAllocationMatrix";
import { useRules } from "@/hooks/useRules";
import { useDepartments } from "@/hooks/useDepartments";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatHours, formatZar } from "@/lib/utils";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];

type ChecklistMutate = ReturnType<typeof useSetServiceChecklist>["mutate"];

function roundToQuarter(h: number): number {
  if (h <= 0) return 0;
  const rounded = Math.round(h / 0.25) * 0.25;
  return rounded === 0 ? 0.25 : rounded;
}

export function ServicesList() {
  const { data: services = [], isLoading } = useServices();
  const { data: rules = [] } = useRules();
  const { data: depts = [] } = useDepartments();
  const { data: matrix } = useAllocationMatrix();
  const ruleMap = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const deptMap = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts]);
  const [q, setQ] = useState("");
  const [ruleFilter, setRuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [groupFilter, setGroupFilter] = useState<Set<string>>(new Set());

  // Each service's "group" is the department carrying its largest allocation.
  // Derived rather than stored so it stays in sync if allocations change.
  const primaryDeptByService = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const s of services) {
      const alloc = matrix?.resolved[s.id];
      let bestId: string | null = null;
      let bestH = 0;
      if (alloc) {
        for (const [deptId, v] of Object.entries(alloc)) {
          if (v.hours > bestH) {
            bestH = v.hours;
            bestId = deptId;
          }
        }
      }
      map[s.id] = bestId;
    }
    return map;
  }, [services, matrix]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let uncategorized = 0;
    for (const s of services) {
      const g = primaryDeptByService[s.id];
      if (g) counts[g] = (counts[g] ?? 0) + 1;
      else uncategorized += 1;
    }
    return { counts, uncategorized };
  }, [services, primaryDeptByService]);

  function toggleGroup(id: string) {
    setGroupFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Lifted: a single mutation handle drives every row's save/revert. mutate() is
  // a stable reference across renders, so the per-row React.memo stays effective.
  const setChecklist = useSetServiceChecklist();
  const setChecklistMutate = setChecklist.mutate;
  const setChecklistPending = setChecklist.isPending;

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (ruleFilter && s.rule_id !== ruleFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (groupFilter.size > 0) {
        const g = primaryDeptByService[s.id];
        const key = g ?? "__none__";
        if (!groupFilter.has(key)) return false;
      }
      if (q) {
        const hay = `${s.code ?? ""} ${s.name}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [services, q, ruleFilter, statusFilter, groupFilter, primaryDeptByService]);

  const groupChips = useMemo(() => {
    const chips = depts
      .map((d) => ({ id: d.id, name: d.name, count: groupCounts.counts[d.id] ?? 0 }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);
    if (groupCounts.uncategorized > 0) {
      chips.push({ id: "__none__", name: "Uncategorized", count: groupCounts.uncategorized });
    }
    return chips;
  }, [depts, groupCounts]);

  const activeFilterCount =
    (ruleFilter ? 1 : 0) +
    (statusFilter && statusFilter !== "active" ? 1 : 0) +
    (groupFilter.size > 0 ? 1 : 0) +
    (q ? 1 : 0);

  function clearAll() {
    setQ("");
    setRuleFilter("");
    setStatusFilter("active");
    setGroupFilter(new Set());
  }

  return (
    <div className="container mx-auto max-w-[1600px] p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-medium">Services</h1>
          <p className="text-body-small text-m-on-surface-variant">
            {filtered.length === services.length ? (
              <>{services.length} services</>
            ) : (
              <>
                <span className="font-medium text-m-on-surface">{filtered.length}</span> of {services.length} services
              </>
            )}
            {" · "}Edit hours per department inline — changes save as an override.
          </p>
        </div>
        <Button asChild>
          <Link to="/services/new">
            <Plus className="h-4 w-4" /> New service
          </Link>
        </Button>
      </div>

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[280px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or code…"
              className="h-10 pl-9 pr-9"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={ruleFilter || "__all__"} onValueChange={(v) => setRuleFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-10 w-[200px]">
              <SelectValue placeholder="All rules" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All rules</SelectItem>
              {rules.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-10 w-[140px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="h-10 text-m-on-surface-variant">
              <X className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </div>

        {groupChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">
              Group
            </span>
            {groupChips.map((c) => {
              const active = groupFilter.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleGroup(c.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-label-small transition-colors",
                    active
                      ? "border-m-primary bg-m-primary text-m-on-primary"
                      : "border-m-outline-variant bg-m-surface text-m-on-surface hover:bg-m-surface-container"
                  )}
                >
                  <span>{c.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums",
                      active ? "bg-m-on-primary/20 text-m-on-primary" : "bg-m-surface-container text-m-on-surface-variant"
                    )}
                  >
                    {c.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="sticky left-0 z-20 bg-card px-3 py-2 w-32 border-b">Group</th>
                    <th className="sticky left-32 z-20 bg-card px-4 py-2 w-24 border-b">Code</th>
                    <th className="sticky left-56 z-20 bg-card px-4 py-2 min-w-[220px] border-b">Name</th>
                    <th className="px-3 py-2 w-[160px] border-b">Rule</th>
                    <th className="px-3 py-2 text-right w-24 border-b">Price</th>
                    {depts.map((d) => (
                      <th key={d.id} className="px-2 py-2 text-right min-w-[84px] border-b" title={`${d.name} — ${formatZar(d.hourly_rate_cents)}/hr`}>
                        {d.name}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right w-20 border-b">Total</th>
                    <th className="px-3 py-2 w-40 border-b" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const groupId = primaryDeptByService[s.id];
                    return (
                      <ServiceRow
                        key={s.id}
                        service={s}
                        departments={depts}
                        ruleName={s.rule_id ? ruleMap.get(s.rule_id)?.name ?? "—" : null}
                        groupName={groupId ? deptMap.get(groupId)?.name ?? null : null}
                        matrix={matrix}
                        setChecklistMutate={setChecklistMutate}
                        setChecklistPending={setChecklistPending}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type ServiceRowProps = {
  service: ServiceWithTotals;
  departments: Department[];
  ruleName: string | null;
  groupName: string | null;
  matrix: AllocationMatrix | undefined;
  setChecklistMutate: ChecklistMutate;
  setChecklistPending: boolean;
};

const ServiceRow = memo(function ServiceRow({
  service,
  departments,
  ruleName,
  groupName,
  matrix,
  setChecklistMutate,
  setChecklistPending,
}: ServiceRowProps) {
  // Look up our own slice of the matrix here so the parent passes a single
  // stable `matrix` reference instead of three derived props that would each
  // be a fresh value on every parent render and defeat React.memo.
  const resolvedByDept = matrix?.resolved[service.id];
  const hasChecklist = matrix?.hasChecklist[service.id] ?? false;
  const childCount = matrix?.childCounts[service.id] ?? 0;

  const isPercentage = service.pricing_model === "percentage";
  const isCompound = childCount > 0;
  const isDerived = isCompound && !hasChecklist;
  const cellReadOnly = hasChecklist || isCompound;

  const initialHours = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of departments) {
      out[d.id] = roundToQuarter(resolvedByDept?.[d.id]?.hours ?? 0);
    }
    return out;
  }, [departments, resolvedByDept]);

  const [hours, setHours] = useState<Record<string, number>>(initialHours);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  useEffect(() => {
    setHours(initialHours);
    setTouched(new Set());
  }, [initialHours]);

  const dirty = touched.size > 0;

  function updateCell(deptId: string, value: string) {
    const n = Number(value);
    setHours((h) => ({ ...h, [deptId]: Number.isFinite(n) ? n : 0 }));
    setTouched((t) => {
      const next = new Set(t);
      next.add(deptId);
      return next;
    });
  }

  function reset() {
    setHours(initialHours);
    setTouched(new Set());
  }

  // Convert hours → pct for display. pct = h * rate / price * 100.
  const price = service.sell_price_cents;
  const pcts = departments.map((d) => {
    if (price <= 0) return 0;
    const h = hours[d.id] ?? 0;
    return Math.round(((h * d.hourly_rate_cents) / price) * 100 * 100) / 100;
  });
  const sumPct = pcts.reduce((a, b) => a + b, 0);
  const sumHours = Object.values(hours).reduce((a, b) => a + b, 0);
  const sumValid = true; // Checklist hours aren't constrained to price; overage shown on detail page.

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
    setChecklistMutate(
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
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  function revert() {
    if (!confirm(`Delete the checklist for ${service.name} and fall back to its rule's allocation?`)) return;
    setChecklistMutate(
      { kind: "clear", serviceId: service.id },
      {
        onSuccess: () => toast.success(`Reverted ${service.name} to rule`),
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  const stickyBg = dirty ? "bg-amber-50" : "bg-card";
  const cellBorder = "border-b";
  return (
    <tr className={cn(dirty && "bg-amber-50/40")}>
      <td className={cn("sticky left-0 z-10 px-3 py-2", cellBorder, stickyBg)}>
        {groupName ? (
          <Badge variant="secondary" className="text-[10px] font-normal">{groupName}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className={cn("sticky left-32 z-10 px-4 py-2 font-mono text-xs text-muted-foreground", cellBorder, stickyBg)}>{service.code ?? "—"}</td>
      <td className={cn("sticky left-56 z-10 px-4 py-2", cellBorder, stickyBg)}>
        <Link to={`/services/${service.id}`} className="font-medium hover:underline">
          {service.name}
        </Link>
        {isCompound && (
          <Badge variant="secondary" className="ml-2 text-[10px]">bundle · {childCount}</Badge>
        )}
        {hasChecklist && !dirty && (
          <Badge variant="outline" className="ml-2 text-[10px]">checklist</Badge>
        )}
      </td>
      <td
        className={cn(
          "px-3 py-2 max-w-[160px] truncate",
          cellReadOnly ? "text-muted-foreground/50" : "text-muted-foreground",
          cellBorder
        )}
        title={
          isDerived
            ? "Derived from included services"
            : ruleName
              ? hasChecklist
                ? `${ruleName} (fallback — checklist is driving allocation)`
                : ruleName
              : undefined
        }
      >
        {isDerived ? (
          <span className="text-muted-foreground">—</span>
        ) : ruleName ? (
          <>
            {ruleName}
            {hasChecklist && <span className="ml-1 text-[10px]">(fallback)</span>}
          </>
        ) : (
          <Badge variant="outline">custom</Badge>
        )}
      </td>
      <td className={cn("px-3 py-2 text-right", cellBorder)}>
        {isPercentage ? `${service.percentage_value ?? 0}%` : formatZar(service.sell_price_cents)}
      </td>
      {departments.map((d) => {
        const inherited = !hasChecklist && !touched.has(d.id);
        const value = hours[d.id] ?? 0;
        if (cellReadOnly) {
          return (
            <td key={d.id} className={cn("px-2 py-2 text-right tabular-nums", cellBorder)}>
              <Link
                to={`/services/${service.id}`}
                className="text-sm text-muted-foreground hover:underline"
                title={isDerived ? "Derived from included services — edit in service detail" : "Edit in service detail"}
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
      <td className={cn("px-3 py-2 text-right tabular-nums", cellBorder)}>
        {sumHours === 0 && !dirty ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn("font-medium", dirty && !sumValid && "text-destructive")}>
            {formatHours(sumHours)}
          </span>
        )}
        {dirty && !isPercentage && (
          <div className={cn("text-[10px]", sumValid ? "text-muted-foreground" : "text-destructive")}>
            {sumPct.toFixed(1)}%
          </div>
        )}
      </td>
      <td className={cn("px-3 py-2", cellBorder)}>
        {dirty ? (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={reset} disabled={setChecklistPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={!sumValid || setChecklistPending}>
              Save
            </Button>
          </div>
        ) : hasChecklist ? (
          <Button size="sm" variant="ghost" onClick={revert} disabled={setChecklistPending} title="Delete checklist and fall back to rule">
            <RotateCcw className="h-3.5 w-3.5" /> Revert
          </Button>
        ) : (
          <Badge variant={service.status === "active" ? "success" : "secondary"}>{service.status}</Badge>
        )}
      </td>
    </tr>
  );
});
