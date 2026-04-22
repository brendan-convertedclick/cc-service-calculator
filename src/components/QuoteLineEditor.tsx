import { Fragment, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, X } from "lucide-react";
import { formatZar } from "@/lib/utils";
import type { Database } from "@/types/db";

type Service = Database["public"]["Tables"]["services"]["Row"];
type Dept = Database["public"]["Tables"]["departments"]["Row"];

export type EditorLine = {
  service_id: string;
  qty: number;
  allocation: Record<string, number>;
  hours: Record<string, number>;
};

type Props = {
  line: EditorLine;
  service: Service;
  depts: Dept[];
  onChange: (patch: Partial<EditorLine>) => void;
  onRemove: () => void;
};

export function QuoteLineEditor({ line, service, depts, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const sumPct = Object.values(line.allocation).reduce((a, b) => a + b, 0);
  const sumOutOfTolerance = sumPct < 99.5 || sumPct > 100.5;
  const activeDepts = depts.filter((d) => (line.allocation[d.id] ?? 0) > 0);
  const totalHours = Object.values(line.hours).reduce((a, b) => a + b, 0) * line.qty;
  const unitCents = service.sell_price_cents ?? 0;
  const totalCents = unitCents * line.qty;
  const topDepts = activeDepts
    .map((d) => ({ name: d.name, pct: line.allocation[d.id] ?? 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 2);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-m-surface-container-low/60"
      >
        <ChevronDown
          className={
            "h-4 w-4 shrink-0 text-m-on-surface-variant transition-transform " +
            (open ? "rotate-0" : "-rotate-90")
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-title-small">{service.name}</span>
            {service.code && (
              <span className="shrink-0 text-label-small text-m-on-surface-variant">
                {service.code}
              </span>
            )}
          </div>
          {!open && (
            <div className="mt-0.5 flex items-center gap-2 text-label-small text-m-on-surface-variant">
              <span className="tabular-nums">Qty {line.qty}</span>
              <span>·</span>
              <span className="tabular-nums">{formatZar(unitCents)}/ea</span>
              <span>·</span>
              <span className="tabular-nums">{totalHours.toFixed(1)}h</span>
              {topDepts.length > 0 && <span>·</span>}
              <span className="truncate">
                {topDepts.map((d) => `${d.name} ${d.pct}%`).join(" · ")}
                {activeDepts.length > topDepts.length &&
                  ` +${activeDepts.length - topDepts.length}`}
              </span>
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-title-small tabular-nums text-m-on-surface">
            {formatZar(totalCents)}
          </div>
          <div className="text-label-small tabular-nums text-m-on-surface-variant">
            {line.qty} × {formatZar(unitCents)}
          </div>
        </div>
        <span
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-label-small tabular-nums " +
            (sumOutOfTolerance
              ? "bg-destructive/10 text-destructive"
              : "bg-m-surface-container text-m-on-surface-variant")
          }
        >
          {sumPct.toFixed(0)}%
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Remove line"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-m-on-surface-variant transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </span>
      </button>

      {open && (
        <CardContent className="space-y-4 border-t border-m-outline-variant/60 p-5">
          <div className="grid grid-cols-4 gap-4 rounded-md bg-m-surface-container-low/40 p-3">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`qty-${line.service_id}`}
                className="text-label-small text-m-on-surface-variant"
              >
                Quantity
              </Label>
              <Input
                id={`qty-${line.service_id}`}
                type="number"
                step="0.25"
                min="0.25"
                className="h-9 text-right tabular-nums"
                value={line.qty}
                onChange={(e) => onChange({ qty: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-label-small text-m-on-surface-variant">Unit price</span>
              <span className="flex h-9 items-center text-title-small tabular-nums text-m-on-surface">
                {formatZar(unitCents)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-label-small text-m-on-surface-variant">Hours</span>
              <span className="flex h-9 items-center tabular-nums text-m-on-surface">
                {totalHours.toFixed(2)}h
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-label-small text-m-on-surface-variant">Line total</span>
              <span className="flex h-9 items-center text-title-medium tabular-nums text-m-primary">
                {formatZar(totalCents)}
              </span>
            </div>
          </div>

          <div className="rounded-md border border-m-outline-variant/60 bg-m-surface-container-low/40">
            <div className="grid grid-cols-[minmax(0,1fr)_96px_80px] items-center gap-x-4 px-3 py-2 text-label-small uppercase tracking-wide text-m-on-surface-variant">
              <span>Department</span>
              <span className="text-right">Allocation</span>
              <span className="text-right">Hours</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_96px_80px] items-center gap-x-4 gap-y-1 border-t border-m-outline-variant/60 px-3 py-2">
              {depts.map((d) => {
                const pct = line.allocation[d.id] ?? 0;
                const hrs = line.hours[d.id] ?? 0;
                const dim = pct === 0;
                return (
                  <Fragment key={d.id}>
                    <span
                      className={
                        dim
                          ? "truncate text-body-small text-m-on-surface-variant/60"
                          : "truncate text-body-small text-m-on-surface"
                      }
                      title={d.name}
                    >
                      {d.name}
                    </span>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        max="100"
                        className="h-8 w-full pr-7 text-right tabular-nums"
                        value={pct}
                        onChange={(e) =>
                          onChange({
                            allocation: { ...line.allocation, [d.id]: Number(e.target.value) },
                          })
                        }
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-label-small text-m-on-surface-variant">
                        %
                      </span>
                    </div>
                    <span
                      className={
                        dim
                          ? "text-right text-body-small tabular-nums text-m-on-surface-variant/60"
                          : "text-right text-body-small tabular-nums text-m-on-surface"
                      }
                    >
                      {hrs.toFixed(2)}h
                    </span>
                  </Fragment>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between text-label-medium">
            <span className="text-m-on-surface-variant">
              {activeDepts.length}{" "}
              {activeDepts.length === 1 ? "department active" : "departments active"}
            </span>
            <span
              className={
                sumOutOfTolerance
                  ? "font-medium text-destructive tabular-nums"
                  : "text-m-on-surface-variant tabular-nums"
              }
            >
              Allocation {sumPct.toFixed(2)}%
            </span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
