import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpsOverviewData, OpsProject } from "@/hooks/useOpsOverview";
import type { DeliveryRate } from "@/hooks/useDeliveryRate";
import type { DftCycleTime } from "@/hooks/useAvgDftCycleTime";
import { ClientMarginContent } from "./ClientMarginContent";
import { scopeBadge, scopeDot, scopeLabel } from "./dashboardFormat";

interface Props {
  opsData: OpsOverviewData;
  monthlyHours: number | null;
  deliveryRate: DeliveryRate | null;
  dftCycleTime: DftCycleTime | null;
  onSelect: (id: string) => void;
}

const TILE =
  "flex min-h-0 flex-col overflow-hidden rounded-xl border border-m-outline-variant bg-m-surface p-4 shadow-elev-1";
const TILE_TITLE = "text-[11px] font-semibold uppercase tracking-wider text-m-on-surface-variant";

function TileHead({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className={TILE_TITLE}>{title}</span>
      {aside && <span className="text-[10px] text-m-on-surface-variant">{aside}</span>}
    </div>
  );
}

/** Calm, centered empty state for a tile's body — teaches rather than reads as broken. */
function TileEmpty({
  icon: Icon,
  children,
}: {
  icon: typeof CheckCircle2;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-center">
      <Icon className="h-5 w-5 text-m-on-surface-variant/50" />
      <p className="text-label-small text-m-on-surface-variant">{children}</p>
    </div>
  );
}

function ProjectItem({ p, onSelect }: { p: OpsProject; onSelect: (id: string) => void }) {
  const showReason = p.reasonText && p.reasonText !== scopeLabel[p.scopeStatus];
  return (
    <button
      type="button"
      onClick={() => onSelect(p.id)}
      className="rounded-lg border border-m-outline-variant bg-m-surface-container-low p-2.5 text-left transition-all hover:border-m-outline hover:bg-m-surface hover:shadow-elev-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m-primary"
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

/** A single figure in the health line. Value + unit in mono, calm label, optional gauge + caption. */
function MetricTile({
  value,
  unit,
  label,
  caption,
  visual,
}: {
  value: React.ReactNode;
  unit?: string;
  label: string;
  caption?: string;
  visual?: React.ReactNode;
}) {
  return (
    <div className={cn(TILE, "justify-between gap-3")}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[30px] font-bold leading-none tracking-tight font-mono tabular-nums text-m-on-surface">
          {value}
          {unit && <span className="ml-0.5 text-base font-semibold text-m-on-surface-variant">{unit}</span>}
        </div>
        {visual}
      </div>
      <div>
        <div className="text-label-medium font-semibold text-m-on-surface">{label}</div>
        {caption && <div className="mt-0.5 text-[11px] text-m-on-surface-variant">{caption}</div>}
      </div>
    </div>
  );
}

export function BentoOverview({ opsData, monthlyHours, deliveryRate, dftCycleTime, onSelect }: Props) {
  const rate = deliveryRate && deliveryRate.total > 0 ? deliveryRate.rate : null;
  const avgDays = dftCycleTime?.avgDays ?? null;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto px-6 pb-6 pt-1">
      {/* Health line — capacity and delivery at a glance */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricTile
          value={monthlyHours !== null ? monthlyHours : "—"}
          unit={monthlyHours !== null ? "h" : undefined}
          label="Burned this month"
          caption="Actuals logged month-to-date"
        />
        <MetricTile
          value={rate !== null ? rate : "—"}
          unit={rate !== null ? "%" : undefined}
          label="On-time delivery"
          caption={
            deliveryRate && deliveryRate.total > 0
              ? `${deliveryRate.onTime} of ${deliveryRate.total} on time`
              : "No deliveries yet"
          }
          visual={
            rate !== null ? (
              <div
                className="relative h-10 w-10 shrink-0 rounded-full"
                role="img"
                aria-label={`${rate}% on time`}
                style={{
                  background: `conic-gradient(hsl(var(--mcolor-tertiary)) 0% ${rate}%, hsl(var(--mcolor-surface-container-highest)) ${rate}% 100%)`,
                }}
              >
                <div className="absolute inset-[5px] rounded-full bg-m-surface" />
              </div>
            ) : undefined
          }
        />
        <MetricTile
          value={avgDays !== null ? avgDays : "—"}
          unit={avgDays !== null ? "d" : undefined}
          label="Brief → DFT"
          caption={
            dftCycleTime && dftCycleTime.sampleSize > 0
              ? `Avg over ${dftCycleTime.sampleSize} project${dftCycleTime.sampleSize !== 1 ? "s" : ""}`
              : "No baseline yet"
          }
        />
      </div>

      {/* Working row — what needs a human, and how margins are trending */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <section className={cn(TILE, "lg:col-span-7")}>
          <TileHead
            title="Needs attention"
            aside={
              opsData.attentionProjects.length > 0 ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold font-mono tabular-nums text-amber-800">
                  {opsData.attentionProjects.length}
                </span>
              ) : undefined
            }
          />
          {opsData.attentionProjects.length === 0 ? (
            <TileEmpty icon={CheckCircle2}>All clear — nothing needs attention.</TileEmpty>
          ) : (
            <div className="grid max-h-[380px] gap-2 overflow-y-auto pr-0.5 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {opsData.attentionProjects.map((p) => (
                <ProjectItem key={p.id} p={p} onSelect={onSelect} />
              ))}
            </div>
          )}
        </section>

        <section className={cn(TILE, "lg:col-span-5")}>
          <TileHead title="Margin · 30 days" aside="rolling" />
          <div className="max-h-[380px] overflow-y-auto pr-0.5">
            <ClientMarginContent variant="bars" />
          </div>
        </section>
      </div>
    </div>
  );
}
