import { cn } from "@/lib/utils";
import type { OpsOverviewData, OpsProject } from "@/hooks/useOpsOverview";
import type { DeliveryRate } from "@/hooks/useDeliveryRate";
import type { DftCycleTime } from "@/hooks/useAvgDftCycleTime";
import type { ScopeFilter } from "./ProjectTree";
import { ClientMarginContent } from "./ClientMarginContent";
import { scopeBadge, scopeDot, scopeLabel } from "./dashboardFormat";

interface Props {
  opsData: OpsOverviewData;
  monthlyHours: number | null;
  deliveryRate: DeliveryRate | null;
  dftCycleTime: DftCycleTime | null;
  scopeFilter: ScopeFilter;
  onScopeFilterChange: (f: ScopeFilter) => void;
  onSelect: (id: string) => void;
}

const TILE = "relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-m-outline-variant bg-m-surface p-4 shadow-elev-1";
const TILE_TITLE = "text-[11px] font-bold uppercase tracking-wider text-m-on-surface-variant";

function TileHead({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className={TILE_TITLE}>{title}</span>
      {aside && <span className="text-[10px] text-m-on-surface-variant">{aside}</span>}
    </div>
  );
}

function ProjectItem({ p, onSelect }: { p: OpsProject; onSelect: (id: string) => void }) {
  const showReason = p.reasonText && p.reasonText !== scopeLabel[p.scopeStatus];
  return (
    <button
      type="button"
      onClick={() => onSelect(p.id)}
      className="rounded-lg border border-m-outline-variant bg-m-surface-container-low p-2.5 text-left transition-all hover:border-m-outline hover:bg-m-surface hover:shadow-elev-1"
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", scopeDot[p.scopeStatus] ?? "bg-gray-400")} />
        <span className="truncate text-label-medium font-semibold text-m-on-surface">
          <span className="text-m-on-surface-variant">{p.clientName} — </span>
          {p.name}
        </span>
      </div>
      {showReason && <p className="mt-1 text-[11px] italic text-m-on-surface-variant">{p.reasonText}</p>}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-bold", scopeBadge[p.scopeStatus])}>
          {scopeLabel[p.scopeStatus] ?? p.scopeStatus}
        </span>
        <span className="rounded border border-m-outline-variant px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-m-on-surface-variant">
          {p.engagementType}
        </span>
      </div>
    </button>
  );
}

function HeroStat({
  value,
  label,
  visual,
}: {
  value: React.ReactNode;
  label: string;
  visual: React.ReactNode;
}) {
  return (
    <div className="flex min-w-[130px] flex-1 flex-col justify-between rounded-xl border border-m-outline-variant bg-m-surface-container-low p-3">
      <div className="text-[28px] font-bold leading-none tracking-tight font-mono tabular-nums text-m-on-surface">{value}</div>
      {visual}
      <div className="mt-1.5 text-[11px] leading-tight text-m-on-surface-variant">{label}</div>
    </div>
  );
}

export function BentoOverview({
  opsData,
  monthlyHours,
  deliveryRate,
  dftCycleTime,
  scopeFilter,
  onScopeFilterChange,
  onSelect,
}: Props) {
  const toggle = (f: ScopeFilter) => onScopeFilterChange(scopeFilter === f ? "all" : f);

  const rate = deliveryRate && deliveryRate.total > 0 ? deliveryRate.rate : null;
  const avgDays = dftCycleTime?.avgDays ?? null;

  // The recent tile doubles as the cross-filter target.
  const filtered =
    scopeFilter === "all"
      ? opsData.recentProjects
      : opsData.projects.filter((p) => p.scopeStatus === scopeFilter);

  const kpiTile = (f: ScopeFilter, count: number, label: string, dot: string, numClass: string) => {
    const active = scopeFilter === f;
    return (
      <button
        type="button"
        onClick={() => toggle(f)}
        aria-pressed={active}
        className={cn(
          TILE,
          "items-start justify-center text-left transition-all hover:shadow-elev-2",
          active && "ring-2 ring-m-primary",
        )}
      >
        <div className={cn("text-[34px] font-bold leading-none font-mono tabular-nums", numClass)}>{count}</div>
        <div className="mt-1.5 flex items-center gap-1.5 text-label-medium font-semibold text-m-on-surface-variant">
          <span className={cn("h-2 w-2 rounded-full", dot)} />
          {label}
        </div>
      </button>
    );
  };

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-1">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4 lg:auto-rows-[minmax(96px,auto)]">
        {/* HERO — capacity & delivery health */}
        <section className={cn(TILE, "lg:col-start-1 lg:col-end-3 lg:row-start-1 lg:row-end-3")}>
          <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-brand" />
          <TileHead title="Capacity & delivery health" aside="this month" />
          <div className="mt-2 flex flex-1 flex-wrap gap-2">
            <HeroStat
              value={monthlyHours !== null ? <>{monthlyHours}<span className="text-base font-semibold text-m-on-surface-variant">h</span></> : "—"}
              label="Burned this month"
              visual={
                <div className="mt-2 flex h-8 items-end gap-1">
                  {[40, 55, 48, 70, 62, 85, 100].map((h, i) => (
                    <span
                      key={i}
                      className={cn(
                        "flex-1 rounded-t",
                        i === 6 ? "bg-gradient-brand" : "bg-m-primary-container",
                      )}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              }
            />
            <HeroStat
              value={rate !== null ? <>{rate}<span className="text-base font-semibold text-m-on-surface-variant">%</span></> : "—"}
              label={
                deliveryRate && deliveryRate.total > 0
                  ? `On-time delivery · ${deliveryRate.onTime}/${deliveryRate.total}`
                  : "On-time delivery"
              }
              visual={
                <div
                  className="relative mt-1.5 h-12 w-12 rounded-full"
                  style={{
                    background: `conic-gradient(hsl(var(--mcolor-tertiary)) 0% ${rate ?? 0}%, hsl(var(--mcolor-surface-container-highest)) ${rate ?? 0}% 100%)`,
                  }}
                >
                  <div className="absolute inset-[6px] rounded-full bg-m-surface" />
                  <span className="absolute inset-0 grid place-items-center text-label-small font-bold font-mono tabular-nums text-m-on-tertiary-container">
                    {rate !== null ? `${rate}%` : "—"}
                  </span>
                </div>
              }
            />
            <HeroStat
              value={avgDays !== null ? <>{avgDays}<span className="text-base font-semibold text-m-on-surface-variant">d</span></> : "—"}
              label={
                dftCycleTime && dftCycleTime.sampleSize > 0
                  ? `Avg brief → DFT · ${dftCycleTime.sampleSize} project${dftCycleTime.sampleSize !== 1 ? "s" : ""}`
                  : "Avg brief → DFT · no baseline"
              }
              visual={
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-m-surface-container-highest">
                  <div
                    className="h-full rounded-full bg-gradient-brand-r"
                    style={{ width: `${avgDays !== null ? Math.max(8, Math.min(100, (avgDays / 10) * 100)) : 0}%` }}
                  />
                </div>
              }
            />
          </div>
        </section>

        {/* NEEDS ATTENTION — tall */}
        <section className={cn(TILE, "lg:col-start-3 lg:col-end-4 lg:row-start-1 lg:row-end-4")}>
          <TileHead
            title="Needs attention"
            aside={
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold font-mono tabular-nums text-amber-800">
                {opsData.attentionProjects.length}
              </span>
            }
          />
          <div className="mt-1 flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-0.5">
            {opsData.attentionProjects.length === 0 ? (
              <p className="py-4 text-center text-label-small italic text-m-on-surface-variant">
                Nothing needs attention.
              </p>
            ) : (
              opsData.attentionProjects.map((p) => <ProjectItem key={p.id} p={p} onSelect={onSelect} />)
            )}
          </div>
        </section>

        {/* MARGIN — tall */}
        <section className={cn(TILE, "lg:col-start-4 lg:col-end-5 lg:row-start-1 lg:row-end-5")}>
          <TileHead title="Margin · 30 days" aside="rolling" />
          <div className="mt-2 max-h-[560px] overflow-y-auto pr-0.5">
            <ClientMarginContent variant="bars" />
          </div>
        </section>

        {/* ON TRACK kpi */}
        {kpiTile("on_track", opsData.onTrackCount, "On track", "bg-m-tertiary", "text-m-on-tertiary-container")}

        {/* OVERDUE kpi */}
        {kpiTile("overdue", opsData.overdueCount, "Overdue", "bg-m-error", "text-m-on-error-container")}

        {/* RECENT / filtered */}
        <section className={cn(TILE, "lg:col-start-1 lg:col-end-4 lg:row-start-4 lg:row-end-5")}>
          <TileHead
            title={scopeFilter === "all" ? "Recent projects" : `Filtered · ${scopeLabel[scopeFilter] ?? scopeFilter}`}
            aside={scopeFilter === "all" ? "most recently started" : `${filtered.length} shown`}
          />
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-label-small italic text-m-on-surface-variant">
              No projects match this filter.
            </p>
          ) : (
            <div className="mt-1 grid max-h-[260px] gap-2 overflow-y-auto pr-0.5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              {filtered.map((p) => (
                <ProjectItem key={p.id} p={p} onSelect={onSelect} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
