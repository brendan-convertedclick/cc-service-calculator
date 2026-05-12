import type { DeliveryMeta } from "@/types/delivery";

interface Props {
  meta: DeliveryMeta;
}

function pct(rate: number): string {
  return `${Math.round(Math.min(rate, 9.99) * 100)}%`;
}

function formatZar(value: number): string {
  if (value >= 1_000_000) return `R ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R ${(value / 1_000).toFixed(0)}K`;
  return `R ${value}`;
}

export function DeliveryMetricCards({ meta }: Props) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-xl bg-m-surface-container p-5 space-y-1">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-wide">
          Delivery Rate
        </p>
        <p className="text-display-small font-semibold text-m-on-surface">
          {pct(meta.overallExternalRate)}
        </p>
        <p className="text-body-small text-m-on-surface-variant">
          external · {pct(meta.overallInternalRate)} internal · {meta.periodLabel}
        </p>
      </div>

      <div className="rounded-xl bg-m-surface-container p-5 space-y-1">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-wide">
          Delivery Speed
        </p>
        <p className="text-display-small font-semibold text-m-on-surface">
          {meta.tasksPerWorkingDay}
          <span className="text-title-medium font-normal text-m-on-surface-variant"> /day</span>
        </p>
        <p className="text-body-small text-m-on-surface-variant">
          {meta.avgCycleDays}d avg cycle · {meta.workingDays} working days
        </p>
      </div>

      <div className="rounded-xl bg-m-surface-container p-5 space-y-1">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-wide">
          Delivery Yield
        </p>
        <p className="text-display-small font-semibold text-m-on-surface">
          {formatZar(meta.totalValueZar)}
        </p>
        <p className="text-body-small text-m-on-surface-variant">
          {formatZar(meta.avgYieldPerHour)}/hr · R{meta.zarPerPoint}/pt
        </p>
      </div>
    </div>
  );
}
