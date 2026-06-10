import { memo, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, RotateCcw, X, ArrowRight } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { cn, formatZar } from "@/lib/utils";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];

type ChecklistMutate = ReturnType<typeof useSetServiceChecklist>["mutate"];

// Fallback ramp for the allocation bar when a department has no `color` of its
// own. Tuned to read distinctly against the light surface while staying in the
// app's cool/violet family.
const DEPT_FALLBACK_COLORS = [
  "#7C3AED", // primary violet
  "#0891B2", // cyan
  "#F59E0B", // amber
  "#22C55E", // green
  "#EC4899", // pink
  "#3B82F6", // blue
  "#14B8A6", // teal
  "#F97316", // orange
  "#8B5CF6", // light violet
  "#84CC16", // lime
];

function deptColor(d: Department, idx: number): string {
  return d.color ?? DEPT_FALLBACK_COLORS[idx % DEPT_FALLBACK_COLORS.length];
}

function roundToQuarter(h: number): number {
  if (h <= 0) return 0;
  const rounded = Math.round(h / 0.25) * 0.25;
  return rounded === 0 ? 0.25 : rounded;
}

/** Compact hours: drops a trailing ".00" so the narrow cell reads "12 h" not "12.00 hr". */
function formatHoursShort(h: number): string {
  const n = Math.round(h * 100) / 100;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
  return `${s} h`;
}

export function ServicesList() {
  const { data: services = [], isLoading } = useServices();
  const { data: rules = [] } = useRules();
  const { data: depts = [] } = useDepartments();
  const { data: matrix } = useAllocationMatrix();
  const ruleMap = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const deptMap = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts]);
  const deptColorById = useMemo(() => {
    const m = new Map<string, string>();
    depts.forEach((d, i) => m.set(d.id, deptColor(d, i)));
    return m;
  }, [depts]);
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

  const groupOptions = useMemo(() => {
    const opts = depts
      .map((d) => ({ value: d.id, label: d.name, count: groupCounts.counts[d.id] ?? 0 }))
      .filter((o) => o.count > 0)
      .sort((a, b) => b.count - a.count);
    if (groupCounts.uncategorized > 0) {
      opts.push({ value: "__none__", label: "Uncategorized", count: groupCounts.uncategorized });
    }
    return opts;
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
    <div className="container mx-auto max-w-[1200px] p-6">
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
            {" · "}Click any allocation to edit hours by department — changes save as an override.
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

          {groupOptions.length > 0 && (
            <MultiSelect
              options={groupOptions}
              values={[...groupFilter]}
              onChange={(vals) => setGroupFilter(new Set(vals))}
              placeholder="All groups"
              searchPlaceholder="Search groups…"
              className="h-10 w-[220px]"
            />
          )}

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="h-10 text-m-on-surface-variant">
              <X className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </div>

      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No services match your filters.
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2.5 w-[150px] border-b">Group</th>
                  <th className="px-3 py-2.5 w-20 border-b">Code</th>
                  <th className="px-3 py-2.5 min-w-[220px] border-b">Name</th>
                  <th className="px-3 py-2.5 w-[150px] border-b">Rule</th>
                  <th className="px-3 py-2.5 text-right w-24 border-b">Price</th>
                  <th className="px-3 py-2.5 w-[260px] border-b">Allocation</th>
                  <th className="px-3 py-2.5 w-[120px] border-b">Status</th>
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
                      deptColorById={deptColorById}
                      ruleName={s.rule_id ? ruleMap.get(s.rule_id)?.name ?? "—" : null}
                      groupName={groupId ? deptMap.get(groupId)?.name ?? null : null}
                      groupColor={groupId ? deptColorById.get(groupId) ?? null : null}
                      matrix={matrix}
                      setChecklistMutate={setChecklistMutate}
                      setChecklistPending={setChecklistPending}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type ServiceRowProps = {
  service: ServiceWithTotals;
  departments: Department[];
  deptColorById: Map<string, string>;
  ruleName: string | null;
  groupName: string | null;
  groupColor: string | null;
  matrix: AllocationMatrix | undefined;
  setChecklistMutate: ChecklistMutate;
  setChecklistPending: boolean;
};

const ServiceRow = memo(function ServiceRow({
  service,
  departments,
  deptColorById,
  ruleName,
  groupName,
  groupColor,
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
  const readOnly = hasChecklist || isCompound;

  const initialHours = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of departments) {
      out[d.id] = roundToQuarter(resolvedByDept?.[d.id]?.hours ?? 0);
    }
    return out;
  }, [departments, resolvedByDept]);

  const [hours, setHours] = useState<Record<string, number>>(initialHours);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setHours(initialHours);
    setTouched(new Set());
  }, [initialHours]);

  const dirty = touched.size > 0;

  function updateCell(deptId: string, value: string) {
    const n = Number(value);
    setHours((h) => ({ ...h, [deptId]: Number.isFinite(n) && n > 0 ? n : 0 }));
    setTouched((t) => {
      const next = new Set(t);
      next.add(deptId);
      return next;
    });
  }

  function step(deptId: string, dir: 1 | -1) {
    const cur = hours[deptId] ?? 0;
    const next = Math.max(0, Math.round((cur + dir * 0.25) * 4) / 4);
    if (next === cur) return; // clamped at 0 (decrementing an empty dept) — no-op, don't dirty the row
    setHours((h) => ({ ...h, [deptId]: next }));
    setTouched((t) => {
      const nt = new Set(t);
      nt.add(deptId);
      return nt;
    });
  }

  function reset() {
    setHours(initialHours);
    setTouched(new Set());
    setOpen(false);
  }

  // Convert hours → cost/pct for the popover footer. pct = cost / price * 100.
  const price = service.sell_price_cents;
  const sumHours = departments.reduce((acc, d) => acc + (hours[d.id] ?? 0), 0);
  const sumCost = departments.reduce((acc, d) => acc + (hours[d.id] ?? 0) * d.hourly_rate_cents, 0);
  const sumPct = price > 0 ? Math.round((sumCost / price) * 100) : 0;

  function save() {
    const hoursByDept: Record<string, number> = {};
    for (const d of departments) {
      // Snap to the quarter-hour grid the steppers/load path use, so a directly
      // typed value (e.g. 1.3) never persists off-grid.
      const h = Math.round((hours[d.id] ?? 0) * 4) / 4;
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
          setOpen(false);
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
        onSuccess: () => {
          setOpen(false);
          toast.success(`Reverted ${service.name} to rule`);
        },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  // Build the per-department view model once for this render.
  const deptRows = departments.map((d) => {
    const h = hours[d.id] ?? 0;
    const inherited = !hasChecklist && !touched.has(d.id);
    return {
      dept: d,
      color: deptColorById.get(d.id) ?? "#7C3AED",
      hours: h,
      inherited,
      cost: h * d.hourly_rate_cents,
    };
  });

  const priceLabel = isPercentage ? `${service.percentage_value ?? 0}%` : formatZar(service.sell_price_cents);

  return (
    <tr className={cn("group", dirty && "bg-amber-50/40")}>
      <td className="px-4 py-2 border-b">
        {groupName ? (
          <span
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-m-outline-variant bg-m-surface-container px-2.5 py-0.5 text-[11px] text-m-on-surface-variant"
            title={groupName}
          >
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: groupColor ?? "var(--mcolor-outline)" }} />
            <span className="truncate">{groupName}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-m-outline px-2.5 py-0.5 text-[11px] text-muted-foreground" title="Uncategorized">
            <span className="h-2 w-2 flex-none rounded-full border border-m-outline" />
            <span className="truncate">Uncategorized</span>
          </span>
        )}
      </td>

      <td className="px-3 py-2 font-mono text-xs text-muted-foreground border-b">{service.code ?? "—"}</td>

      <td className="px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Link to={`/services/${service.id}`} className="truncate font-medium hover:underline" title={service.name}>
            {service.name}
          </Link>
          {isCompound && (
            <Badge variant="secondary" className="flex-none text-[10px]">bundle · {childCount}</Badge>
          )}
          {hasChecklist && !dirty && (
            <Badge variant="outline" className="flex-none text-[10px]">checklist</Badge>
          )}
        </div>
      </td>

      <td
        className={cn(
          "px-3 py-2 max-w-[150px] truncate text-xs border-b",
          readOnly ? "text-muted-foreground/60" : "text-muted-foreground"
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
          <span className="text-muted-foreground/60">—</span>
        ) : ruleName ? (
          <>
            {ruleName}
            {hasChecklist && <span className="ml-1 text-[10px] italic">(fallback)</span>}
          </>
        ) : (
          <Badge variant="outline" className="text-[10px]">custom</Badge>
        )}
      </td>

      <td className="px-3 py-2 text-right tabular-nums border-b">{priceLabel}</td>

      <td className="px-3 py-2 border-b">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors",
                "hover:bg-m-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                dirty && "bg-amber-50 ring-1 ring-inset ring-amber-300 hover:bg-amber-50",
                open && !dirty && "bg-m-surface-container-high"
              )}
              aria-label={`Edit hour allocation for ${service.name}`}
            >
              <AllocationBar
                deptRows={deptRows}
                totalHours={sumHours}
                inherited={!hasChecklist && !dirty}
                readOnly={readOnly}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[360px] p-3" onOpenAutoFocus={(e) => readOnly && e.preventDefault()}>
            <div className="mb-2 flex items-baseline justify-between gap-2 border-b pb-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="flex-none font-mono text-[11px] text-muted-foreground">{service.code ?? "—"}</span>
                <strong className="truncate text-[13px] font-semibold" title={service.name}>{service.name}</strong>
              </div>
              <Link
                to={`/services/${service.id}`}
                className="flex flex-none items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
              >
                detail <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {isCompound && (
              <div className="mb-2 rounded-md bg-m-tertiary-container px-2.5 py-1.5 text-[11px] leading-snug text-m-on-tertiary-container">
                Derived from {childCount} included service{childCount === 1 ? "" : "s"} — edit hours in the service detail.
              </div>
            )}

            <div className="space-y-0.5">
              {deptRows.map(({ dept, color, hours: h, inherited, cost }) => (
                <div key={dept.id} className="flex items-center gap-2 py-0.5">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ background: h > 0 ? color : "var(--mcolor-outline-variant)" }}
                  />
                  <span className="w-[96px] flex-none truncate text-[12px] font-medium" title={dept.name}>
                    {dept.name}
                  </span>
                  <span className="w-[60px] flex-none font-mono text-[10px] text-muted-foreground">
                    {formatZar(dept.hourly_rate_cents)}/h
                  </span>
                  {readOnly ? (
                    <span className={cn("flex-none font-mono text-[12px]", h > 0 ? "" : "text-m-outline")}>
                      {h > 0 ? formatHoursShort(h) : "—"}
                    </span>
                  ) : (
                    <div className="flex h-6 flex-none items-center overflow-hidden rounded-md border border-m-outline-variant">
                      <button
                        type="button"
                        onClick={() => step(dept.id, -1)}
                        className="flex h-full w-5 items-center justify-center bg-m-surface-container text-muted-foreground hover:bg-m-surface-container-high hover:text-foreground"
                        aria-label={`Decrease ${dept.name}`}
                        tabIndex={-1}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        step="0.25"
                        min={0}
                        value={h}
                        onChange={(e) => updateCell(dept.id, e.target.value)}
                        className={cn(
                          "h-full w-11 border-0 bg-background text-center font-mono text-[12px] tabular-nums outline-none focus:bg-primary/5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                          inherited ? "italic text-muted-foreground" : "font-medium text-foreground"
                        )}
                        aria-label={`${dept.name} hours`}
                      />
                      <button
                        type="button"
                        onClick={() => step(dept.id, 1)}
                        className="flex h-full w-5 items-center justify-center bg-m-surface-container text-muted-foreground hover:bg-m-surface-container-high hover:text-foreground"
                        aria-label={`Increase ${dept.name}`}
                        tabIndex={-1}
                      >
                        +
                      </button>
                    </div>
                  )}
                  <span className={cn("ml-auto flex-none font-mono text-[11px] text-muted-foreground", h > 0 ? "" : "text-m-outline")}>
                    {h > 0 ? formatZar(cost) : "—"}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2.5">
              <div className="text-[11px] text-muted-foreground">
                Total <b className="font-semibold text-foreground">{formatHoursShort(sumHours)}</b>
                {isPercentage ? (
                  <> · <b className="font-semibold text-foreground">{formatZar(sumCost)}</b></>
                ) : (
                  <> · <b className="font-semibold text-foreground">{sumPct}%</b> of price</>
                )}
              </div>
              {readOnly ? (
                hasChecklist ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={revert}
                    disabled={setChecklistPending}
                    className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Revert to rule
                  </Button>
                ) : (
                  <span className="text-[11px] italic text-muted-foreground">read-only</span>
                )
              ) : (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={reset} disabled={!dirty || setChecklistPending} className="h-7">
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={!dirty || setChecklistPending} className="h-7">
                    Save
                  </Button>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </td>

      <td className="px-3 py-2 border-b">
        {dirty && !open ? (
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={save} disabled={setChecklistPending} className="h-7">
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={reset}
              disabled={setChecklistPending}
              className="h-7 w-7 p-0"
              aria-label="Discard changes"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Badge variant={service.status === "active" ? "success" : "secondary"}>{service.status}</Badge>
        )}
      </td>
    </tr>
  );
});

type DeptRow = {
  dept: Department;
  color: string;
  hours: number;
  inherited: boolean;
  cost: number;
};

/**
 * The single calm allocation cell: total hours + a tiny stacked segment bar,
 * one colored slice per department carrying hours. Replaces the old wall of
 * eight columns of grey zeros. Zero-hour editable rows get a "Set hours" ghost.
 */
function AllocationBar({
  deptRows,
  totalHours,
  inherited,
  readOnly,
}: {
  deptRows: DeptRow[];
  totalHours: number;
  inherited: boolean;
  readOnly: boolean;
}) {
  const active = deptRows.filter((r) => r.hours > 0);

  if (totalHours <= 0) {
    if (readOnly) {
      return <span className="text-[12px] text-muted-foreground">—</span>;
    }
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Plus className="h-3.5 w-3.5" /> Set hours
      </span>
    );
  }

  return (
    <>
      <span
        className={cn(
          "w-[52px] flex-none text-right font-mono text-[11px] tabular-nums",
          inherited ? "italic font-normal text-muted-foreground" : "font-medium text-foreground"
        )}
      >
        {formatHoursShort(totalHours)}
      </span>
      <span className="flex h-1.5 min-w-0 flex-1 gap-px">
        {active.map((r) => (
          <span
            key={r.dept.id}
            className="block min-w-[3px] rounded-sm first:rounded-l-sm last:rounded-r-sm"
            style={{ flex: `${r.hours} 1 0%`, background: r.color }}
            title={`${r.dept.name} · ${formatHoursShort(r.hours)}`}
          />
        ))}
      </span>
    </>
  );
}
