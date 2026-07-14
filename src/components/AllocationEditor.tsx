import { Fragment } from "react";
import { X } from "lucide-react";
import { cn, formatHours, formatZar } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/types/db";
import { SUM_TOLERANCE_MAX, SUM_TOLERANCE_MIN, isSumValid, resolveAllocation, sumPct, totalHours } from "@/lib/allocation";

type Department = Database["public"]["Tables"]["departments"]["Row"];

export type AllocRow = { department_id: string; pct: number };

interface Props {
  allocations: AllocRow[];
  departments: Department[];
  priceCents?: number; // when provided, previews price shares and hours
  readOnly?: boolean;
  onChange?: (next: AllocRow[]) => void;
}

export function AllocationEditor({ allocations, departments, priceCents, readOnly, onChange }: Props) {
  const deptRef = departments.map((d) => ({ id: d.id, name: d.name, hourly_rate_cents: d.hourly_rate_cents }));
  const resolved = priceCents != null ? resolveAllocation(priceCents, allocations, deptRef) : null;
  const sum = sumPct(allocations);
  const valid = isSumValid(allocations);

  const used = new Set(allocations.map((a) => a.department_id));
  const available = departments.filter((d) => !used.has(d.id));

  function update(i: number, patch: Partial<AllocRow>) {
    const next = allocations.slice();
    next[i] = { ...next[i], ...patch };
    onChange?.(next);
  }
  function remove(i: number) {
    const next = allocations.slice();
    next.splice(i, 1);
    onChange?.(next);
  }
  function add(departmentId: string) {
    onChange?.([...allocations, { department_id: departmentId, pct: 0 }]);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_100px_auto_auto] gap-2 text-xs uppercase text-muted-foreground">
        <div>Department</div>
        <div className="text-right">%</div>
        {resolved && <div className="text-right">Hours</div>}
        {!readOnly && <div />}
      </div>
      {allocations.map((a, i) => {
        const dept = departments.find((d) => d.id === a.department_id);
        const r = resolved?.[i];
        return (
          <Fragment key={a.department_id}>
            <div className="grid grid-cols-[1fr_100px_auto_auto] items-center gap-2">
              <div>
                <div className="text-sm font-medium">{dept?.name ?? "Unknown"}</div>
                {dept && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono tabular-nums">{formatZar(dept.hourly_rate_cents)}</span>/hr
                    {r && <> · <span className="font-mono tabular-nums">{formatZar(r.priceShareCents)}</span></>}
                  </div>
                )}
              </div>
              {readOnly ? (
                <div className="text-right text-sm font-mono tabular-nums">{a.pct.toFixed(2)}%</div>
              ) : (
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={a.pct}
                  className="text-right"
                  onChange={(e) => update(i, { pct: Number(e.target.value) })}
                />
              )}
              {resolved && <div className="text-right text-sm font-mono tabular-nums">{r ? formatHours(r.hours) : "—"}</div>}
              {!readOnly && (
                <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </Fragment>
        );
      })}

      {!readOnly && available.length > 0 && (
        <div>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) add(e.target.value);
            }}
            className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-sm"
          >
            <option value="">+ add department</option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Total</span>
          <Badge variant={valid ? "success" : "destructive"} className="font-mono tabular-nums">{sum.toFixed(2)}%</Badge>
          {!valid && (
            <span className="text-xs text-muted-foreground">
              must be between <span className="font-mono tabular-nums">{SUM_TOLERANCE_MIN}</span> and <span className="font-mono tabular-nums">{SUM_TOLERANCE_MAX}</span>
            </span>
          )}
        </div>
        {resolved && (
          <div className="text-muted-foreground">
            <span className={cn("font-medium font-mono tabular-nums", valid ? "text-foreground" : "text-muted-foreground")}>
              {formatHours(totalHours(resolved))}
            </span>{" "}
            total budgeted hours
          </div>
        )}
      </div>
    </div>
  );
}
