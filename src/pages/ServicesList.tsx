import { memo, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, X, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServices, useDeleteService, type ServiceWithTotals } from "@/hooks/useServices";
import { useAllocationMatrix, type AllocationMatrix } from "@/hooks/useAllocationMatrix";
import { useRules } from "@/hooks/useRules";
import { useDepartments } from "@/hooks/useDepartments";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSetServiceXeroItem, useXeroItems } from "@/hooks/useXeroItems";
import {
  useServiceProcedures,
  useSetServiceProcedure,
  type ProcedureOption,
} from "@/hooks/useServiceProcedure";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatZar, toggleInSet, errorMessage } from "@/lib/utils";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];


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

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
] as const;

export function ServicesList() {
  const { data: services = [], isLoading } = useServices();
  const { data: rules = [] } = useRules();
  const { data: depts = [] } = useDepartments();
  const { data: matrix } = useAllocationMatrix();
  const [q, setQ] = useState("");
  const [ruleFilter, setRuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const deptMap = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts]);
  const deptColorById = useMemo(() => {
    const m = new Map<string, string>();
    depts.forEach((d, i) => m.set(d.id, deptColor(d, i)));
    return m;
  }, [depts]);
  const [procedureFilter, setProcedureFilter] = useState<"" | "none" | "linked">("");
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

  const deleteService = useDeleteService();
  const { data: xeroItems = [] } = useXeroItems();
  const setXero = useSetServiceXeroItem();
  const xeroByService = useMemo(() => {
    const m = new Map<string, { code: string; name: string }>();
    for (const x of xeroItems) for (const sv of x.services) m.set(sv.id, { code: x.code, name: x.name });
    return m;
  }, [xeroItems]);
  // Every line is offered to every service: several services legitimately bill
  // as the same one, so nothing is ever "taken".
  const allXero = useMemo(
    () => xeroItems.map((x) => ({ code: x.code, name: x.name })),
    [xeroItems],
  );

  const { data: procedures = [] } = useServiceProcedures();
  const setProcedure = useSetServiceProcedure();
  const procedureByService = useMemo(() => {
    const m = new Map<string, ProcedureOption>();
    for (const p of procedures) if (p.serviceId) m.set(p.serviceId, p);
    return m;
  }, [procedures]);
  // Only approved procedures are offered, and only ones not already spoken for.
  const freeApproved = useMemo(
    () => procedures.filter((p) => p.approved && !p.serviceId),
    [procedures],
  );

  const startsWithDigit = (name: string) => /^\d/.test(name.trim());

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (ruleFilter && s.rule_id !== ruleFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (procedureFilter === "none" && procedureByService.has(s.id)) return false;
      if (procedureFilter === "linked" && !procedureByService.has(s.id)) return false;
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
    }).sort((a, b) => {
      const da = startsWithDigit(a.name);
      const db = startsWithDigit(b.name);
      if (da !== db) return da ? 1 : -1;
      return a.name.localeCompare(b.name, "en", { numeric: true });
    });
  }, [services, q, ruleFilter, statusFilter, groupFilter, primaryDeptByService, procedureFilter, procedureByService]);

  // Counted across every service, not the filtered view — it is the size of the
  // backlog, and it should not shrink because a search box is filled in.
  const withoutProcedureCount = useMemo(
    () => services.filter((s) => !procedureByService.has(s.id)).length,
    [services, procedureByService],
  );

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

  function toggleGroup(value: string) {
    setGroupFilter((prev) => toggleInSet(prev, value));
  }

  return (
    <div className="flex h-full">
      {/* ── Left filter rail: search on top → divider → filter groups below ── */}
      <aside className="w-56 shrink-0 space-y-5 overflow-y-auto border-r border-m-outline-variant p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Search services"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-10 pl-8 pr-8"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-label-large text-m-on-surface">Filters</h3>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-label-small text-m-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-label-medium text-m-on-surface-variant">Status</h4>
          <ul className="space-y-0.5">
            {STATUS_FILTERS.map((opt) => (
              <FilterRow
                key={opt.value}
                label={opt.label}
                active={statusFilter === opt.value}
                onClick={() => setStatusFilter(opt.value)}
              />
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <h4 className="text-label-medium text-m-on-surface-variant">Procedure</h4>
          <ul className="space-y-0.5">
            <FilterRow label="All" active={procedureFilter === ""} onClick={() => setProcedureFilter("")} />
            <FilterRow
              label={`No procedure yet${withoutProcedureCount ? ` · ${withoutProcedureCount}` : ""}`}
              active={procedureFilter === "none"}
              onClick={() => setProcedureFilter("none")}
            />
            <FilterRow
              label="Has a procedure"
              active={procedureFilter === "linked"}
              onClick={() => setProcedureFilter("linked")}
            />
          </ul>
        </div>

        {rules.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-label-medium text-m-on-surface-variant">Rule</h4>
            <ul className="space-y-0.5">
              <FilterRow label="All rules" active={ruleFilter === ""} onClick={() => setRuleFilter("")} />
              {rules.map((r) => (
                <FilterRow
                  key={r.id}
                  label={r.name}
                  active={ruleFilter === r.id}
                  onClick={() => setRuleFilter(r.id)}
                />
              ))}
            </ul>
          </div>
        )}

        {groupOptions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-label-medium text-m-on-surface-variant">Group</h4>
            <div className="space-y-0.5">
              {groupOptions.map((opt) => {
                const active = groupFilter.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleGroup(opt.value)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label-medium tracking-normal transition-colors ${
                      active
                        ? "bg-m-secondary-container text-m-on-secondary-container"
                        : "text-m-on-surface hover:bg-m-surface-container"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                        active
                          ? "border-m-primary bg-m-primary text-m-on-primary"
                          : "border-m-outline"
                      }`}
                    >
                      {active && (
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1 truncate">{opt.label}</span>
                    <span className="tabular-nums text-label-small text-m-on-surface-variant">{opt.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
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
              {" · "}Click a row to open the service.
            </p>
          </div>
          <Button asChild>
            <Link to="/services/new">
              <Plus className="h-4 w-4" /> New service
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/services/xero">Xero products</Link>
          </Button>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No services match your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-separate border-spacing-0 text-xs">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2.5 w-12 border-b text-right">#</th>
                    <th className="px-3 py-2.5 min-w-[200px] border-b">Name</th>
                    <th className="px-3 py-2.5 w-[320px] border-b" title="The Xero product this is invoiced as">Invoice line</th>
                    <th className="px-3 py-2.5 w-[280px] border-b">Procedure</th>
                    <th className="px-3 py-2.5 text-right w-24 border-b">Price</th>
                    {/* No heading: edit/delete, revealed on hover. */}
                    <th className="px-3 py-2.5 w-[90px] border-b" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => {
                    const groupId = primaryDeptByService[s.id];
                    return (
                      <ServiceRow
                        key={s.id}
                        index={i + 1}
                        service={s}
                        groupName={groupId ? deptMap.get(groupId)?.name ?? null : null}
                        groupColor={groupId ? deptColorById.get(groupId) ?? null : null}
                        matrix={matrix}
                        procedure={procedureByService.get(s.id) ?? null}
                        procedureOptions={freeApproved}
                        xero={xeroByService.get(s.id) ?? null}
                        xeroOptions={allXero}
                        onXeroChange={(code) =>
                          setXero.mutate(
                            { serviceId: s.id, code },
                            { onError: (e) => toast.error(`Could not link the Xero line: ${errorMessage(e)}`) },
                          )
                        }
                        onProcedureChange={(procedureId) =>
                          setProcedure.mutate(
                            { serviceId: s.id, procedureId },
                            { onError: (e) => toast.error(`Could not link the procedure: ${errorMessage(e)}`) },
                          )
                        }
                        onDelete={() =>
                          deleteService.mutate(s.id, {
                            onSuccess: () => toast.success(`Deleted "${s.name}"`),
                            onError: (e) => {
                              const msg = errorMessage(e);
                              toast.error(
                                /foreign key|violates/i.test(msg)
                                  ? `"${s.name}" is in use — a retainer, quote or estimate still refers to it. Remove those first, or set it to Archived instead.`
                                  : `Could not delete: ${msg}`,
                              );
                            },
                          })
                        }
                        deletePending={deleteService.isPending}
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
    </div>
  );
}

type ServiceRowProps = {
  service: ServiceWithTotals;
  groupName: string | null;
  groupColor: string | null;
  matrix: AllocationMatrix | undefined;
  /** The procedure this service is delivered by, if one is attached. */
  procedure: ProcedureOption | null;
  /** Approved procedures not already attached to another service. */
  procedureOptions: ProcedureOption[];
  onProcedureChange: (procedureId: string | null) => void;
  /** The Xero product this service is invoiced as. Xero is the source of truth
   *  for quoting and invoicing; this says which line the work belongs to. */
  xero: { code: string; name: string } | null;
  xeroOptions: { code: string; name: string }[];
  onXeroChange: (code: string | null) => void;
  /** Position in the list as filtered — 1, 2, 3 — not a stored code. */
  index: number;
  onDelete: () => void;
  deletePending: boolean;
};

const ServiceRow = memo(function ServiceRow({
  service,
  procedure,
  procedureOptions,
  onProcedureChange,
  xero,
  xeroOptions,
  onXeroChange,
  index,
  onDelete,
  deletePending,
  groupName,
  groupColor,
  matrix,
}: ServiceRowProps) {
  // Look up our own slice of the matrix here so the parent passes a single
  // stable `matrix` reference rather than a derived prop that would be a fresh
  // value on every parent render and defeat React.memo.
  // Deleting a service is not undoable and the row carries no warning of its
  // own, so it asks first — in place, rather than a dialog over the table.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  const childCount = matrix?.childCounts[service.id] ?? 0;

  const isPercentage = service.pricing_model === "percentage";
  const isCompound = childCount > 0;

  const priceLabel = isPercentage ? `${service.percentage_value ?? 0}%` : formatZar(service.sell_price_cents);

  return (
    <tr
      className="group cursor-pointer"
      onClick={(e) => {
        // The row is full of selects, links and buttons — a bare onClick would
        // fire while someone was picking a procedure.
        const el = e.target as HTMLElement;
        if (el.closest("button, a, select, input, textarea")) return;
        navigate(`/services/${service.id}`);
      }}
    >
      <td
        className="px-3 py-2 text-right font-mono text-xs text-muted-foreground border-b"
        title={groupName ?? "Uncategorized"}
      >
        <span className="flex items-center justify-end gap-1.5">
          <span
            className="h-2 w-2 flex-none rounded-full"
            style={{ background: groupColor ?? "var(--mcolor-outline)" }}
          />
          {index}
        </span>
      </td>

      <td className="px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Link to={`/services/${service.id}`} className="truncate font-medium hover:underline" title={service.name}>
            {service.name}
          </Link>
          {isCompound && (
            <Badge variant="secondary" className="flex-none text-[10px]">bundle · {childCount}</Badge>
          )}
        </div>
      </td>

      {/* What the client actually sees on the invoice. Xero owns this list —
          renaming a service here never changes an invoice line. */}
      <td className="px-3 py-2 border-b">
        <select
          aria-label={`Xero invoice line for ${service.name}`}
          value={xero?.code ?? ""}
          onChange={(e) => onXeroChange(e.target.value || null)}
          className={cn(
            "h-8 w-full rounded-md border bg-m-surface px-1.5 text-label-small",
            xero ? "border-m-outline-variant text-m-on-surface" : "border-dashed border-m-outline-variant text-m-on-surface-variant",
          )}
        >
          <option value="">— not sold separately</option>
          {xeroOptions.map((o) => (
            <option key={o.code} value={o.code}>{o.name}</option>
          ))}
        </select>
      </td>

      {/* Which documented procedure delivers this service. Only approved ones
          are offered — pointing a sold service at a draft would be telling
          someone to follow something nobody has signed off. */}
      <td className="px-3 py-2 border-b">
        <select
          aria-label={`Procedure for ${service.name}`}
          value={procedure?.id ?? ""}
          onChange={(e) => onProcedureChange(e.target.value || null)}
          className={cn(
            "h-8 w-full rounded-md border bg-m-surface px-1.5 text-label-small",
            procedure ? "border-m-outline-variant text-m-on-surface" : "border-dashed border-m-outline-variant text-m-on-surface-variant",
          )}
        >
          <option value="">— none</option>
          {/* The attached one may not be approved any more, or may never have
              been; keep it listed so selecting something else is a choice
              rather than the only way to make the box show the truth. */}
          {procedure && !procedureOptions.some((o) => o.id === procedure.id) && (
            <option value={procedure.id}>
              {procedure.name}
              {procedure.approved ? "" : " (not approved)"}
            </option>
          )}
          {procedureOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </td>


      <td className="px-3 py-2 text-right font-mono tabular-nums border-b">{priceLabel}</td>



      <td className="px-3 py-2 border-b">
        {confirmDelete ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              disabled={deletePending}
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
              className="rounded-md bg-m-error px-2 py-1 text-label-small text-m-on-error disabled:opacity-40"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              aria-label="Keep this service"
              className="rounded-md p-1 text-m-on-surface-variant hover:bg-m-surface-container-high"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Link
              to={`/services/${service.id}`}
              aria-label={`Edit ${service.name}`}
              title="Edit this service"
              className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              aria-label={`Delete ${service.name}`}
              title="Delete this service"
              disabled={deletePending}
              onClick={() => setConfirmDelete(true)}
              className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
});

function FilterRow({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-label-medium tracking-normal transition-colors",
          active
            ? "bg-m-secondary-container text-m-on-secondary-container"
            : "text-m-on-surface hover:bg-m-surface-container",
        )}
      >
        <span className="truncate">{label}</span>
        {count !== undefined && (
          <span className="tabular-nums text-label-small text-m-on-surface-variant">{count}</span>
        )}
      </button>
    </li>
  );
}
