import { useState } from "react";
import { ChevronDown, Check, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";
import type { OpsOverviewData, OpsProject } from "@/hooks/useOpsOverview";
import type { DeliveryRate } from "@/hooks/useDeliveryRate";
import type { DftCycleTime } from "@/hooks/useAvgDftCycleTime";
import { ClientMarginContent } from "./ClientMarginContent";

export interface DeliveredProject {
  id: string;
  name: string;
  clientName: string;
  engagementType: string;
  completedAt: string | null;
}

interface Props {
  opsData: OpsOverviewData;
  monthlyHours: number | null;
  deliveryRate: DeliveryRate | null;
  dftCycleTime: DftCycleTime | null;
  recentlyDelivered: DeliveredProject[];
  lastBriefActivity: Map<string, string>;
  onSelect: (id: string) => void;
}

type LaneKey = "overdue" | "attention" | "ontrack" | "delivered" | "margin";

const LANE_STYLE: Record<LaneKey, { head: string; dot: string; tick: string }> = {
  overdue: { head: "bg-m-error-container", dot: "bg-m-error", tick: "bg-m-error" },
  attention: { head: "bg-amber-100", dot: "bg-amber-400", tick: "bg-amber-400" },
  ontrack: { head: "bg-m-tertiary-container", dot: "bg-m-tertiary", tick: "bg-m-tertiary" },
  delivered: { head: "bg-green-50", dot: "bg-green-500", tick: "bg-green-500" },
  margin: { head: "bg-m-surface-container-high", dot: "bg-m-primary", tick: "bg-gradient-brand" },
};

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col border-l border-m-outline-variant pl-5 first:border-l-0 first:pl-0">
      <span className="text-label-large font-semibold tabular-nums text-m-on-surface">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-m-on-surface-variant">{label}</span>
    </div>
  );
}

function BoardCard({
  dot,
  client,
  name,
  engagement,
  reason,
  foot,
  onClick,
}: {
  dot: string;
  client: string;
  name: string;
  engagement: string;
  reason?: string;
  foot?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-m-outline-variant bg-m-surface p-2.5 text-left shadow-elev-1 transition-all hover:-translate-y-0.5 hover:border-m-outline hover:shadow-elev-2"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
        <span className="text-[10.5px] font-semibold text-m-on-surface-variant">{client}</span>
        <span className="ml-auto rounded-full bg-m-surface-container-high px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-m-on-primary-container">
          {engagement}
        </span>
      </div>
      <div className="text-label-medium font-bold leading-tight text-m-on-surface">{name}</div>
      {reason && <p className="mt-1 text-[11px] italic text-m-on-surface-variant">{reason}</p>}
      {foot && (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-dashed border-m-outline-variant pt-1.5 text-[10px] font-medium text-m-on-surface-variant">
          {foot}
        </div>
      )}
    </button>
  );
}

function Lane({
  laneKey,
  name,
  hint,
  count,
  collapsed,
  onToggle,
  children,
}: {
  laneKey: LaneKey;
  name: string;
  hint: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const s = LANE_STYLE[laneKey];

  if (collapsed) {
    return (
      <section className="flex h-full w-12 shrink-0 flex-col overflow-hidden rounded-2xl border border-m-outline-variant bg-m-surface-container">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={`Expand ${name} lane`}
          className={cn("relative flex h-full flex-col items-center gap-2 rounded-2xl py-3", s.head)}
        >
          <span className={cn("absolute inset-y-3 left-0 w-0.5 rounded-r", s.tick)} />
          <ChevronDown className="h-4 w-4 -rotate-90 text-m-on-surface-variant" />
          <span className={cn("h-2.5 w-2.5 rounded-full", s.dot)} />
          {count !== undefined && (
            <span className="rounded-full border border-m-outline-variant bg-m-surface px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-m-on-surface">
              {count}
            </span>
          )}
          <span className="mt-1 text-label-medium font-bold text-m-on-surface [writing-mode:vertical-rl]">
            {name}
          </span>
        </button>
      </section>
    );
  }

  return (
    <section className="flex h-full w-[272px] min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-m-outline-variant bg-m-surface-container">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={true}
        aria-label={`Collapse ${name} lane`}
        className={cn("relative flex items-center gap-2 border-b border-m-outline-variant px-3 py-3", s.head)}
      >
        <span className={cn("absolute inset-x-3 top-0 h-0.5 rounded-b", s.tick)} />
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.dot)} />
        <span className="text-label-medium font-bold text-m-on-surface">{name}</span>
        {count !== undefined && (
          <span className="rounded-full border border-m-outline-variant bg-m-surface px-2 py-0.5 text-[11px] font-bold tabular-nums text-m-on-surface">
            {count}
          </span>
        )}
        <ChevronDown className="ml-auto h-4 w-4 text-m-on-surface-variant" />
      </button>
      <p className="px-3 pb-0.5 pt-2 text-[10px] font-medium text-m-on-surface-variant">{hint}</p>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">{children}</div>
    </section>
  );
}

const ACTIVITY_ICON = <MessageSquare className="h-3 w-3 opacity-70" />;
const CHECK_ICON = <Check className="h-3 w-3 opacity-70" />;

export function BoardOverview({
  opsData,
  monthlyHours,
  deliveryRate,
  dftCycleTime,
  recentlyDelivered,
  lastBriefActivity,
  onSelect,
}: Props) {
  // "On track" is healthy, no-action work that the project rail already lists in
  // full — collapse it by default so the board leads with what needs a human.
  const [collapsed, setCollapsed] = useState<Set<LaneKey>>(() => new Set<LaneKey>(["ontrack"]));
  const toggle = (k: LaneKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const byStatus = (status: string) => opsData.projects.filter((p) => p.scopeStatus === status);
  const rate = deliveryRate && deliveryRate.total > 0 ? `${deliveryRate.rate}%` : "—";

  const statusCard = (p: OpsProject, dot: string) => {
    const activity = lastBriefActivity.get(p.id);
    const reason = p.reasonText && p.reasonText !== "Overdue" && p.reasonText !== "Needs attention" ? p.reasonText : undefined;
    return (
      <BoardCard
        key={p.id}
        dot={dot}
        client={p.clientName}
        name={p.name}
        engagement={p.engagementType}
        reason={reason}
        foot={
          activity ? (
            <>
              {ACTIVITY_ICON}
              Active <span className="font-semibold tabular-nums text-m-on-surface">{timeAgo(activity).replace(" ago", "")}</span>
            </>
          ) : undefined
        }
        onClick={() => onSelect(p.id)}
      />
    );
  };

  const empty = (text: string) => (
    <p className="px-1 py-3 text-center text-label-small italic text-m-on-surface-variant">{text}</p>
  );

  const overdue = byStatus("overdue");
  const attention = byStatus("needs_attention");
  const ontrack = byStatus("on_track");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* KPI strip */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-m-outline-variant px-6 py-3">
        <Stat value={monthlyHours !== null ? `${monthlyHours}h` : "—"} label="Burned · MTD" />
        <Stat
          value={rate}
          label={deliveryRate && deliveryRate.total > 0 ? `On-time · ${deliveryRate.onTime}/${deliveryRate.total}` : "On-time"}
        />
        <Stat
          value={dftCycleTime?.avgDays !== null && dftCycleTime?.avgDays !== undefined ? `${dftCycleTime.avgDays}d` : "—"}
          label={dftCycleTime && dftCycleTime.sampleSize > 0 ? `Brief→DFT · ${dftCycleTime.sampleSize}` : "Brief→DFT"}
        />
        <Stat value={`${opsData.totalActiveProjects}`} label="Active total" />
      </header>

      {/* Board */}
      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto px-6 py-4">
        <Lane laneKey="overdue" name="Overdue" hint="Past due — act today" count={opsData.overdueCount} collapsed={collapsed.has("overdue")} onToggle={() => toggle("overdue")}>
          {overdue.length === 0 ? empty("Nothing overdue.") : overdue.map((p) => statusCard(p, LANE_STYLE.overdue.dot))}
        </Lane>

        <Lane laneKey="attention" name="Needs attention" hint="Watch this week" count={opsData.needsAttentionCount} collapsed={collapsed.has("attention")} onToggle={() => toggle("attention")}>
          {attention.length === 0 ? empty("Nothing flagged.") : attention.map((p) => statusCard(p, LANE_STYLE.attention.dot))}
        </Lane>

        <Lane laneKey="ontrack" name="On track" hint="Healthy — no action needed" count={opsData.onTrackCount} collapsed={collapsed.has("ontrack")} onToggle={() => toggle("ontrack")}>
          {ontrack.length === 0 ? empty("No active projects.") : ontrack.map((p) => statusCard(p, LANE_STYLE.ontrack.dot))}
        </Lane>

        <Lane laneKey="delivered" name="Recently delivered" hint="Closed recently" count={recentlyDelivered.length} collapsed={collapsed.has("delivered")} onToggle={() => toggle("delivered")}>
          {recentlyDelivered.length === 0
            ? empty("Nothing delivered yet.")
            : recentlyDelivered.map((p) => (
                <BoardCard
                  key={p.id}
                  dot={LANE_STYLE.delivered.dot}
                  client={p.clientName}
                  name={p.name}
                  engagement={p.engagementType}
                  foot={
                    p.completedAt ? (
                      <>
                        {CHECK_ICON}
                        Closed <span className="font-semibold tabular-nums text-m-on-surface">{timeAgo(p.completedAt).replace(" ago", "")}</span>
                      </>
                    ) : undefined
                  }
                  onClick={() => onSelect(p.id)}
                />
              ))}
        </Lane>

        <Lane laneKey="margin" name="Margin · 30d" hint="Target margin · rolling" collapsed={collapsed.has("margin")} onToggle={() => toggle("margin")}>
          <ClientMarginContent variant="rows" />
        </Lane>
      </div>
    </div>
  );
}
