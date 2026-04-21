import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAllocationMatrix, useServices, useSetServiceChecklist, type ServiceWithTotals } from "@/hooks/useServices";
import { useRules } from "@/hooks/useRules";
import { useDepartments } from "@/hooks/useDepartments";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatHours, formatZar } from "@/lib/utils";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];

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
  const [q, setQ] = useState("");
  const [ruleFilter, setRuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (ruleFilter && s.rule_id !== ruleFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (q) {
        const hay = `${s.code ?? ""} ${s.name}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [services, q, ruleFilter, statusFilter]);

  return (
    <div className="container mx-auto max-w-[1600px] p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
          <p className="text-sm text-muted-foreground">
            {services.length} services loaded. {filtered.length !== services.length && <>Showing {filtered.length}.</>} Edit hours per department inline — changes save as an override for that service.
          </p>
        </div>
        <Button asChild>
          <Link to="/services/new">
            <Plus className="h-4 w-4" /> New service
          </Link>
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or code…" className="pl-9" />
          </div>
          <select value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">All rules</option>
            {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="sticky left-0 z-20 bg-card px-4 py-2 w-24 border-b">Code</th>
                    <th className="sticky left-24 z-20 bg-card px-4 py-2 min-w-[220px] border-b">Name</th>
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
                  {filtered.map((s) => (
                    <ServiceRow
                      key={s.id}
                      service={s}
                      departments={depts}
                      ruleName={s.rule_id ? ruleMap.get(s.rule_id)?.name ?? "—" : null}
                      resolvedByDept={matrix?.resolved.get(s.id)}
                      hasChecklist={matrix?.hasChecklist.has(s.id) ?? false}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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
  const isPercentage = service.pricing_model === "percentage";
  const setChecklist = useSetServiceChecklist();

  const initialHours = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of departments) {
      out[d.id] = roundToQuarter(resolvedByDept?.get(d.id)?.hours ?? 0);
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
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  function revert() {
    if (!confirm(`Delete the checklist for ${service.name} and fall back to its rule's allocation?`)) return;
    setChecklist.mutate(
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
      <td className={cn("sticky left-0 z-10 px-4 py-2 font-mono text-xs text-muted-foreground", cellBorder, stickyBg)}>{service.code ?? "—"}</td>
      <td className={cn("sticky left-24 z-10 px-4 py-2", cellBorder, stickyBg)}>
        <Link to={`/services/${service.id}`} className="font-medium hover:underline">
          {service.name}
        </Link>
        {hasChecklist && !dirty && (
          <Badge variant="outline" className="ml-2 text-[10px]">checklist</Badge>
        )}
      </td>
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
      <td className={cn("px-3 py-2 text-right", cellBorder)}>
        {isPercentage ? `${service.percentage_value ?? 0}%` : formatZar(service.sell_price_cents)}
      </td>
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
    </tr>
  );
}
