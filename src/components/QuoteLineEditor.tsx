import { Fragment, memo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, Repeat, X } from "lucide-react";
import { formatZar } from "@/lib/utils";
import { SUM_TOLERANCE_MIN, SUM_TOLERANCE_MAX } from "@/lib/allocation";
import type { Database } from "@/types/db";

type Service = Database["public"]["Tables"]["services"]["Row"];
type Dept = Database["public"]["Tables"]["departments"]["Row"];
type Interval = Database["public"]["Enums"]["recurrence_interval"];

export type EditorLine = {
  service_id: string;
  qty: number;
  /** Unit price carried from the scope receipt; null = catalogue sell price. */
  unit_price_override_cents: number | null;
  allocation: Record<string, number>;
  hours: Record<string, number>;
  is_recurring: boolean;
  recurrence_interval: Interval | null;
  recurrence_start: string;
  recurrence_end: string;
};

type Props = {
  index: number;
  line: EditorLine;
  service: Service;
  depts: Dept[];
  perServiceRecurrence: boolean;
  onChange: (index: number, patch: Partial<EditorLine>) => void;
  onRemove: (serviceId: string) => void;
};

export const QuoteLineEditor = memo(function QuoteLineEditor({
  index,
  line,
  service,
  depts,
  perServiceRecurrence,
  onChange,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  const sumPct = Object.values(line.allocation).reduce((a, b) => a + b, 0);
  const sumOutOfTolerance = sumPct < SUM_TOLERANCE_MIN || sumPct > SUM_TOLERANCE_MAX;
  const activeDepts = depts.filter((d) => (line.allocation[d.id] ?? 0) > 0);
  const totalHours = Object.values(line.hours).reduce((a, b) => a + b, 0) * line.qty;
  const unitCents = line.unit_price_override_cents ?? service.sell_price_cents ?? 0;
  const isCustomPrice =
    line.unit_price_override_cents != null &&
    line.unit_price_override_cents !== (service.sell_price_cents ?? 0);
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
              <span className="tabular-nums">Qty <span className="font-mono tabular-nums">{line.qty}</span></span>
              <span>·</span>
              <span className="tabular-nums"><span className="font-mono tabular-nums">{formatZar(unitCents)}</span>/ea</span>
              <span>·</span>
              <span className="font-mono tabular-nums">{totalHours.toFixed(1)}h</span>
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
          <div className="text-title-small font-mono tabular-nums text-m-on-surface">
            {formatZar(totalCents)}
          </div>
          <div className="text-label-small font-mono tabular-nums text-m-on-surface-variant">
            {line.qty} × {formatZar(unitCents)}
            {isCustomPrice && <span className="font-sans"> · custom</span>}
          </div>
        </div>
        {perServiceRecurrence && line.is_recurring && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-m-primary/10 px-2 py-0.5 text-label-small text-m-primary"
            title={line.recurrence_interval ?? "Recurring"}
          >
            <Repeat className="h-3 w-3" />
            {line.recurrence_interval ?? "—"}
          </span>
        )}
        <span
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-label-small font-mono tabular-nums " +
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
            onRemove(line.service_id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemove(line.service_id);
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
                className="h-9 text-right font-mono tabular-nums"
                value={line.qty}
                onChange={(e) => onChange(index, { qty: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-label-small text-m-on-surface-variant">Unit price</span>
              <span className="flex h-9 items-center text-title-small font-mono tabular-nums text-m-on-surface">
                {formatZar(unitCents)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-label-small text-m-on-surface-variant">Hours</span>
              <span className="flex h-9 items-center font-mono tabular-nums text-m-on-surface">
                {totalHours.toFixed(2)}h
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-label-small text-m-on-surface-variant">Line total</span>
              <span className="flex h-9 items-center text-title-medium font-mono tabular-nums text-m-primary">
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
                        className="h-8 w-full pr-7 text-right font-mono tabular-nums"
                        value={pct}
                        onChange={(e) =>
                          onChange(index, {
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
                          ? "text-right text-body-small font-mono tabular-nums text-m-on-surface-variant/60"
                          : "text-right text-body-small font-mono tabular-nums text-m-on-surface"
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
              Allocation <span className="font-mono tabular-nums">{sumPct.toFixed(2)}%</span>
            </span>
          </div>

          {perServiceRecurrence && (
            <div className="rounded-md border border-m-outline-variant/60 bg-m-surface-container-low/40 p-3 space-y-3">
              <Label className="flex items-center gap-2 text-body-small">
                <input
                  type="checkbox"
                  checked={line.is_recurring}
                  onChange={(e) => onChange(index, { is_recurring: e.target.checked })}
                  className="h-4 w-4"
                />
                <Repeat className="h-4 w-4 text-m-on-surface-variant" />
                Recurring service
              </Label>
              {line.is_recurring && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-label-small text-m-on-surface-variant">Interval</Label>
                    <select
                      value={line.recurrence_interval ?? ""}
                      onChange={(e) =>
                        onChange(index, {
                          recurrence_interval: (e.target.value || null) as Interval | null,
                        })
                      }
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">—</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Biweekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-label-small text-m-on-surface-variant">Start</Label>
                    <Input
                      type="date"
                      value={line.recurrence_start}
                      onChange={(e) => onChange(index, { recurrence_start: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-label-small text-m-on-surface-variant">End</Label>
                    <Input
                      type="date"
                      value={line.recurrence_end}
                      onChange={(e) => onChange(index, { recurrence_end: e.target.value })}
                      placeholder="Ongoing"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
});
