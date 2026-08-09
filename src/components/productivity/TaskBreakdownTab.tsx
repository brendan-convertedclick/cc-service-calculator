// src/components/productivity/TaskBreakdownTab.tsx
//
// Productivity → Tasks tab. Two sub-views:
//   - "By Person" — X = bucket, stacks = tasks. When a member is selected
//     in the sidebar, the chart is filtered to that member.
//   - "By Task" — multi-select tasks, X = bucket, stacks = selected tasks
//     (summed across the team, or restricted to a selected member).
import { useMemo, useState } from "react";
import { useTaskBreakdown, type TaskBreakdownView } from "@/hooks/useTaskBreakdown";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { TeamMember } from "@/hooks/useTeam";
import { TOOLTIP_STYLE_BORDERED, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE } from "./chartShared";
import { errorMessage } from "@/lib/utils";

interface Props {
  members: TeamMember[];
  selectedUserId: number | null;
}

const VIEWS: TaskBreakdownView[] = ["day", "week", "month", "year"];
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TASK_PALETTE = [
  "#7C3AED", "#EC4899", "#0891B2", "#059669", "#D97706",
  "#E11D48", "#4F46E5", "#10B981", "#F59E0B", "#8B5CF6",
  "#06B6D4", "#84CC16", "#F97316", "#EF4444", "#3B82F6",
];

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function navigate(view: TaskBreakdownView, date: string, direction: 1 | -1): string {
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  if (view === "year") dt.setFullYear(dt.getFullYear() + direction);
  else if (view === "month") dt.setMonth(dt.getMonth() + direction);
  else if (view === "week") dt.setDate(dt.getDate() + direction * 7);
  else dt.setDate(dt.getDate() + direction);
  return toLocalISO(dt);
}

function sortBuckets(view: TaskBreakdownView, buckets: string[]): string[] {
  if (view === "week") {
    return DAY_ORDER.filter((d) => buckets.includes(d));
  }
  return [...buckets].sort();
}

function shorten(name: string, max = 28): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1).trimEnd() + "…";
}

export function TaskBreakdownTab({ members, selectedUserId }: Props) {
  const [view, setView] = useState<TaskBreakdownView>("week");
  const [date, setDate] = useState(() => toLocalISO(new Date()));
  const [subTab, setSubTab] = useState<"by-person" | "by-task">("by-person");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error, refetch, isFetching } = useTaskBreakdown(
    view,
    date,
    selectedUserId ?? undefined,
  );

  const filteredEntries = useMemo(() => {
    if (!data) return [];
    if (selectedUserId === null) return data.entries;
    return data.entries.filter((e) => e.userId === selectedUserId);
  }, [data, selectedUserId]);

  // Task ordering: by total hours desc — stable colors & visual hierarchy.
  const orderedTasks = useMemo(() => {
    const totals = new Map<string, { name: string; hours: number }>();
    for (const e of filteredEntries) {
      const t = totals.get(e.taskId);
      if (t) t.hours += e.hours;
      else totals.set(e.taskId, { name: e.taskName, hours: e.hours });
    }
    return Array.from(totals.entries())
      .map(([id, v]) => ({ id, name: v.name, hours: v.hours }))
      .sort((a, b) => b.hours - a.hours);
  }, [filteredEntries]);

  // --- By Person chart shape ---
  // X = bucket; stacks = tasks (taskId_<id>); when no member selected, all
  // members' hours are summed per task per bucket.
  const byPersonChart = useMemo(() => {
    const allBuckets = new Set<string>();
    const map = new Map<string, Record<string, number | string>>();
    for (const e of filteredEntries) {
      allBuckets.add(e.bucket);
      const row = map.get(e.bucket) ?? { bucket: e.bucket };
      const key = `t_${e.taskId}`;
      row[key] = ((row[key] as number) ?? 0) + e.hours;
      map.set(e.bucket, row);
    }
    const sorted = sortBuckets(view, Array.from(allBuckets));
    return sorted.map((b) => map.get(b) ?? { bucket: b });
  }, [filteredEntries, view]);

  // --- By Task chart shape ---
  // X = bucket; stacks = ONLY selected tasks. If no tasks selected, render
  // the top 5 tasks by hours as a default starting point.
  const taskOptions = useMemo(() => orderedTasks, [orderedTasks]);
  const effectiveSelectedIds = useMemo(() => {
    if (selectedTaskIds.size > 0) return selectedTaskIds;
    // Default: top 5
    return new Set(taskOptions.slice(0, 5).map((t) => t.id));
  }, [selectedTaskIds, taskOptions]);

  const byTaskChart = useMemo(() => {
    const allBuckets = new Set<string>();
    const map = new Map<string, Record<string, number | string>>();
    for (const e of filteredEntries) {
      if (!effectiveSelectedIds.has(e.taskId)) continue;
      allBuckets.add(e.bucket);
      const row = map.get(e.bucket) ?? { bucket: e.bucket };
      const key = `t_${e.taskId}`;
      row[key] = ((row[key] as number) ?? 0) + e.hours;
      map.set(e.bucket, row);
    }
    const sorted = sortBuckets(view, Array.from(allBuckets));
    return sorted.map((b) => map.get(b) ?? { bucket: b });
  }, [filteredEntries, effectiveSelectedIds, view]);

  const colorForTaskIdx = (i: number) => TASK_PALETTE[i % TASK_PALETTE.length];

  const selectedMember = selectedUserId
    ? members.find((m) => m.clickup_user_id === selectedUserId)
    : null;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-headline-medium text-m-on-surface">
          Tasks {selectedMember && <span className="text-m-on-surface-variant text-body-large">· {selectedMember.full_name}</span>}
        </h1>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDate(navigate(view, date, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-full text-m-on-surface-variant hover:bg-m-surface-container"
              aria-label="Previous period"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-40 text-center text-body-medium font-medium text-m-on-surface">
              {data?.meta.periodLabel ?? ""}
            </span>
            <button
              type="button"
              onClick={() => setDate(navigate(view, date, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full text-m-on-surface-variant hover:bg-m-surface-container"
              aria-label="Next period"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex h-8 w-8 items-center justify-center rounded-full text-m-on-surface-variant hover:bg-m-surface-container disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="flex items-center rounded-full bg-m-surface-container p-1 gap-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-full text-label-large capitalize ${
                  view === v
                    ? "bg-m-primary text-m-on-primary font-semibold"
                    : "text-m-on-surface-variant hover:text-m-on-surface"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-0 border-b border-m-outline-variant -mx-6 px-6">
        {(["by-person", "by-task"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSubTab(t)}
            data-testid={`tasks-subtab-${t}`}
            className={`px-5 py-3 text-label-medium border-b-2 -mb-px transition-colors ${
              subTab === t
                ? "text-m-primary border-m-primary"
                : "text-m-on-surface-variant border-transparent hover:text-m-on-surface"
            }`}
          >
            {t === "by-person" ? "By Person" : "By Task"}
          </button>
        ))}
      </div>

      {isError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-medium text-destructive">
          Failed to load task breakdown: {errorMessage(error)}
        </p>
      )}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-body-medium text-m-on-surface-variant">
          Loading…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Total hours" value={`${data?.meta.totalHours ?? 0}h`} valueClassName="text-title-medium font-mono tabular-nums" />
            <MetricCard label="Distinct tasks" value={String(orderedTasks.length)} valueClassName="text-title-medium font-mono tabular-nums" />
            <MetricCard
              label="Period"
              value={data?.meta.periodLabel ?? ""}
              valueClassName="text-title-small"
            />
          </div>

          {subTab === "by-person" && (
            <ByPersonView
              chartData={byPersonChart}
              orderedTasks={orderedTasks}
              colorForTaskIdx={colorForTaskIdx}
            />
          )}

          {subTab === "by-task" && (
            <ByTaskView
              chartData={byTaskChart}
              taskOptions={taskOptions}
              selectedTaskIds={selectedTaskIds}
              effectiveSelectedIds={effectiveSelectedIds}
              setSelectedTaskIds={setSelectedTaskIds}
              colorForTaskIdx={colorForTaskIdx}
            />
          )}
        </>
      )}
    </>
  );
}

function MetricCard({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4">
      <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">{label}</p>
      <p className={`mt-1 font-semibold text-m-on-surface ${valueClassName ?? "text-title-medium"}`}>
        {value}
      </p>
    </div>
  );
}

function ByPersonView({
  chartData,
  orderedTasks,
  colorForTaskIdx,
}: {
  chartData: Record<string, number | string>[];
  orderedTasks: { id: string; name: string; hours: number }[];
  colorForTaskIdx: (i: number) => string;
}) {
  if (orderedTasks.length === 0) {
    return (
      <EmptyState message="No time tracked in this period. Pick a different week or sync ClickUp actuals." />
    );
  }
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
      <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">Stacked by task</p>
      <p className="mt-0.5 text-title-medium font-semibold text-m-on-surface">Hours per task</p>
      <div className="mt-4 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 16, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE_BORDERED}
              labelStyle={TOOLTIP_LABEL_STYLE}
              formatter={(value, name) => [`${Number(value).toFixed(2)}h`, name]}
              itemStyle={TOOLTIP_ITEM_STYLE}
            />
            {orderedTasks.map((t, i) => (
              <Bar
                key={t.id}
                dataKey={`t_${t.id}`}
                name={shorten(t.name)}
                stackId="hours"
                fill={colorForTaskIdx(i)}
                fillOpacity={0.9}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-body-small">
        {orderedTasks.slice(0, 12).map((t, i) => (
          <span
            key={t.id}
            className="flex items-center gap-1.5 rounded-full bg-m-surface px-2.5 py-1 text-m-on-surface-variant"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: colorForTaskIdx(i) }}
            />
            {shorten(t.name, 32)}
            <span className="text-m-on-surface-variant/70">· <span className="font-mono tabular-nums">{t.hours.toFixed(1)}</span>h</span>
          </span>
        ))}
        {orderedTasks.length > 12 && (
          <span className="text-m-on-surface-variant/70 text-body-small">
            + {orderedTasks.length - 12} more
          </span>
        )}
      </div>
    </div>
  );
}

function ByTaskView({
  chartData,
  taskOptions,
  selectedTaskIds,
  effectiveSelectedIds,
  setSelectedTaskIds,
  colorForTaskIdx,
}: {
  chartData: Record<string, number | string>[];
  taskOptions: { id: string; name: string; hours: number }[];
  selectedTaskIds: Set<string>;
  effectiveSelectedIds: Set<string>;
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  colorForTaskIdx: (i: number) => string;
}) {
  if (taskOptions.length === 0) {
    return (
      <EmptyState message="No tasks tracked in this period." />
    );
  }
  const renderedTasks = taskOptions.filter((t) => effectiveSelectedIds.has(t.id));
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4">
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
        <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">Compare</p>
        <p className="mt-0.5 text-title-medium font-semibold text-m-on-surface">
          Hours per selected task ({renderedTasks.length} selected)
        </p>
        <div className="mt-4 h-80">
          {renderedTasks.length === 0 ? (
            <div className="flex h-full items-center justify-center text-body-medium text-m-on-surface-variant">
              Select one or more tasks →
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#1e2433", border: "1px solid #2d3748", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#e2e8f0", marginBottom: 4 }}
                  formatter={(value, name) => [`${Number(value).toFixed(2)}h`, name]}
                  itemStyle={{ color: "#94a3b8" }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {renderedTasks.map((t) => {
                  const idx = taskOptions.findIndex((x) => x.id === t.id);
                  return (
                    <Bar
                      key={t.id}
                      dataKey={`t_${t.id}`}
                      name={shorten(t.name)}
                      stackId="hours"
                      fill={colorForTaskIdx(idx)}
                      fillOpacity={0.9}
                    />
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div
        className="rounded-xl border border-m-outline-variant bg-m-surface-container p-4 max-h-96 overflow-y-auto"
        data-testid="task-picker"
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-label-medium font-semibold text-m-on-surface">
            Tasks ({selectedTaskIds.size || `top ${Math.min(5, taskOptions.length)} default`})
          </p>
          {selectedTaskIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTaskIds(() => new Set())}
              className="text-label-small text-m-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <div className="space-y-2">
          {taskOptions.map((t, i) => {
            const checked = selectedTaskIds.has(t.id);
            return (
              <label
                key={t.id}
                className="flex items-start gap-2 cursor-pointer hover:bg-m-surface rounded px-1.5 py-1"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    setSelectedTaskIds((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(t.id);
                      else next.delete(t.id);
                      return next;
                    });
                  }}
                />
                <span
                  className="h-2.5 w-2.5 rounded-sm flex-shrink-0 mt-1.5"
                  style={{ background: colorForTaskIdx(i) }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-body-small text-m-on-surface truncate">{t.name}</span>
                  <span className="block text-label-small text-m-on-surface-variant">
                    <span className="font-mono tabular-nums">{t.hours.toFixed(1)}</span>h
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-8 text-center text-body-medium text-m-on-surface-variant">
      {message}
    </div>
  );
}

