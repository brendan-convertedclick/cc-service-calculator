import { useState } from "react";
import {
  ChevronDown,
  Check,
  CheckCheck,
  CheckCircle,
  CircleAlert,
  TriangleAlert,
  MessageSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, toggleInSet } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";
import type { OpsOverviewData, OpsProject } from "@/hooks/useOpsOverview";
import type { DeliveryRate } from "@/hooks/useDeliveryRate";
import type { DftCycleTime } from "@/hooks/useAvgDftCycleTime";

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

type LaneKey = "ontrack" | "attention" | "overdue" | "delivered";

const LANE_STYLE: Record<
  LaneKey,
  { head: string; tick: string; icon: LucideIcon; iconColor: string }
> = {
  ontrack: { head: "bg-m-tertiary-container", tick: "bg-m-tertiary", icon: CheckCircle, iconColor: "text-m-tertiary" },
  attention: { head: "bg-amber-100", tick: "bg-amber-400", icon: TriangleAlert, iconColor: "text-amber-500" },
  overdue: { head: "bg-m-error-container", tick: "bg-m-error", icon: CircleAlert, iconColor: "text-m-error" },
  delivered: { head: "bg-green-50", tick: "bg-green-500", icon: CheckCheck, iconColor: "text-green-600" },
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
  icon: Icon,
  iconColor,
  client,
  name,
  engagement,
  reason,
  foot,
  onClick,
}: {
  icon: LucideIcon;
  iconColor: string;
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
      className="rounded-2xl border border-m-outline-variant bg-m-surface p-2.5 text-left shadow-elev-1 transition-all hover:-translate-y-0.5 hover:border-m-outline hover:shadow-elev-2"
    >
      <div className="mb-1 flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
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
  const LaneIcon = s.icon;

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
          <LaneIcon className={cn("h-4 w-4", s.iconColor)} />
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
        <LaneIcon className={cn("h-4 w-4 shrink-0", s.iconColor)} />
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

// Whole-day countdown to a due date, phrased relative to today.
function dueLabel(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const days = Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "due today";
  return `due in ${days}d`;
}

export interface ClientGroup<T> {
  client: string;
  items: T[];
}

// Cluster cards so every client's cards sit together, newest first within each
// client, and clients ordered by their most-recent card (newest at the top).
function groupByClient<T>(
  items: T[],
  clientOf: (t: T) => string,
  dateOf: (t: T) => string | null | undefined,
): ClientGroup<T>[] {
  const ts = (d: string | null | undefined) => (d ? Date.parse(d) || 0 : 0);
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const arr = groups.get(clientOf(it));
    if (arr) arr.push(it);
    else groups.set(clientOf(it), [it]);
  }
  for (const arr of groups.values()) arr.sort((a, b) => ts(dateOf(b)) - ts(dateOf(a)));
  // After the within-group sort, each group's first card is its newest, so
  // ordering groups by that card orders the clients by recency.
  return [...groups.entries()]
    .map(([client, arr]) => ({ client, items: arr }))
    .sort((a, b) => ts(dateOf(b.items[0])) - ts(dateOf(a.items[0])));
}

// Wraps one client's cards; when a client has more than one, a thin, subtle rail
// down the left connects them into a group.
function ClientRail({ multi, children }: { multi: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2", multi && "relative pl-2")}>
      {multi && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-m-outline" />}
      {children}
    </div>
  );
}

export function BoardOverview({
  opsData,
  monthlyHours,
  deliveryRate,
  dftCycleTime,
  recentlyDelivered,
  lastBriefActivity,
  onSelect,
}: Props) {
  // All lanes open by default — "On track" included — so the board shows the
  // full picture up front; each lane can still be collapsed individually.
  const [collapsed, setCollapsed] = useState<Set<LaneKey>>(() => new Set<LaneKey>());
  const toggle = (k: LaneKey) => setCollapsed((prev) => toggleInSet(prev, k));

  const byStatus = (status: string) => opsData.projects.filter((p) => p.scopeStatus === status);
  const rate = deliveryRate && deliveryRate.total > 0 ? `${deliveryRate.rate}%` : "—";

  const statusCard = (p: OpsProject, style: { icon: LucideIcon; iconColor: string }) => {
    const activity = lastBriefActivity.get(p.id);
    const due = dueLabel(p.dueDate);
    const reason = p.reasonText && p.reasonText !== "Overdue" && p.reasonText !== "Needs attention" ? p.reasonText : undefined;
    const foot =
      activity || due ? (
        <>
          {activity && (
            <>
              {ACTIVITY_ICON}
              Active <span className="font-semibold tabular-nums text-m-on-surface">{timeAgo(activity).replace(" ago", "")}</span>
            </>
          )}
          {activity && due && <span className="text-m-outline">·</span>}
          {due && <span className="font-semibold tabular-nums text-m-on-surface">{due}</span>}
        </>
      ) : undefined;
    return (
      <BoardCard
        key={p.id}
        icon={style.icon}
        iconColor={style.iconColor}
        client={p.clientName}
        name={p.name}
        engagement={p.engagementType}
        reason={reason}
        foot={foot}
        onClick={() => onSelect(p.id)}
      />
    );
  };

  const deliveredCard = (p: DeliveredProject) => (
    <BoardCard
      key={p.id}
      icon={LANE_STYLE.delivered.icon}
      iconColor={LANE_STYLE.delivered.iconColor}
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
  );

  const empty = (text: string) => (
    <p className="px-1 py-3 text-center text-label-small italic text-m-on-surface-variant">{text}</p>
  );

  // Render one lane's client groups, drawing the connecting rail whenever a
  // client owns more than one card.
  function renderGroups<T>(groups: ClientGroup<T>[], renderCard: (item: T) => React.ReactNode) {
    return groups.map((g) => (
      <ClientRail key={g.client} multi={g.items.length > 1}>
        {g.items.map(renderCard)}
      </ClientRail>
    ));
  }

  // Active lanes order by the same date the card foot shows (last brief
  // activity), falling back to when the project started.
  const activeDate = (p: OpsProject) => lastBriefActivity.get(p.id) ?? p.startedAt;
  const groupActive = (status: string) =>
    groupByClient(byStatus(status), (p) => p.clientName, activeDate);

  const overdue = groupActive("overdue");
  const attention = groupActive("needs_attention");
  const ontrack = groupActive("on_track");
  const delivered = groupByClient(recentlyDelivered, (p) => p.clientName, (p) => p.completedAt);

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
        <Lane laneKey="ontrack" name="On track" hint="Healthy — no action needed" count={opsData.onTrackCount} collapsed={collapsed.has("ontrack")} onToggle={() => toggle("ontrack")}>
          {ontrack.length === 0
            ? empty("No active projects.")
            : renderGroups(ontrack, (p) => statusCard(p, LANE_STYLE.ontrack))}
        </Lane>

        <Lane laneKey="attention" name="Needs attention" hint="Watch this week" count={opsData.needsAttentionCount} collapsed={collapsed.has("attention")} onToggle={() => toggle("attention")}>
          {attention.length === 0
            ? empty("Nothing flagged.")
            : renderGroups(attention, (p) => statusCard(p, LANE_STYLE.attention))}
        </Lane>

        <Lane laneKey="overdue" name="Overdue" hint="Past due — act today" count={opsData.overdueCount} collapsed={collapsed.has("overdue")} onToggle={() => toggle("overdue")}>
          {overdue.length === 0
            ? empty("Nothing overdue.")
            : renderGroups(overdue, (p) => statusCard(p, LANE_STYLE.overdue))}
        </Lane>

        <Lane laneKey="delivered" name="Recently delivered" hint="Closed recently" count={recentlyDelivered.length} collapsed={collapsed.has("delivered")} onToggle={() => toggle("delivered")}>
          {delivered.length === 0
            ? empty("Nothing delivered yet.")
            : renderGroups(delivered, deliveredCard)}
        </Lane>
      </div>
    </div>
  );
}
