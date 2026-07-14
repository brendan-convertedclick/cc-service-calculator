// src/components/productivity/ParallelView.tsx
import { HeatmapCell, MultiplierPeriod, ParallelData } from "@/hooks/useOutputMultiplier";

const MIN_HOUR = 5;
const MAX_HOUR = 23;

function periodDates(period: MultiplierPeriod, anchor: string): string[] {
  const [y, mo, da] = anchor.split("-").map(Number);
  const ref = new Date(y, mo - 1, da);
  const dates: string[] = [];

  if (period === "week") {
    // Mon–Sun of the ISO week containing anchor
    const dow = ref.getDay(); // 0=Sun
    const monday = new Date(ref);
    monday.setDate(ref.getDate() - ((dow + 6) % 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
  } else if (period === "month") {
    const daysInMonth = new Date(y, mo, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
      dates.push(`${String(y)}-${String(mo).padStart(2, "0")}-${String(i).padStart(2, "0")}`);
    }
  } else {
    for (let m = 1; m <= 12; m++) {
      dates.push(`${String(y)}-${String(m).padStart(2, "0")}-01`);
    }
  }
  return dates;
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function formatDayHeader(dateStr: string): string {
  const [y, mo, da] = dateStr.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${day} ${da}`;
}

function cellColorClass(sessions: number, peak: number): string {
  if (sessions === 0) return "bg-m-surface-container-high/60 border-m-outline-variant/20";
  if (peak <= 0) return "bg-violet-400/50 border-violet-400/30";
  const ratio = sessions / peak;
  if (ratio <= 0.33) return "bg-violet-300/60 border-violet-400/30";
  if (ratio <= 0.66) return "bg-violet-500/70 border-violet-500/40";
  return "bg-violet-700/85 border-violet-600/50";
}

interface Props {
  data: ParallelData;
  period: MultiplierPeriod;
  anchorDate: string;
}

export function ParallelView({ data, period, anchorDate }: Props) {
  const { heatmap, summary, periodLabel } = data;

  const dates = periodDates(period, anchorDate);
  const hours = Array.from({ length: MAX_HOUR - MIN_HOUR + 1 }, (_, i) => i + MIN_HOUR);

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3">
        <Chip
          label="Peak concurrent"
          value={`${summary.peak_concurrent}×`}
          sub={`at ${formatHour(summary.peak_hour)} local`}
        />
        <Chip
          label="Total AI output"
          value={`${summary.total_ai_hours}h`}
          sub={`wall-clock ≈ ${summary.wall_clock_hours}h`}
        />
        <Chip
          label="Active hour slots"
          value={String(summary.active_hours)}
          sub="hours with AI sessions running"
        />
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6 overflow-x-auto">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
          AI activity by hour — {periodLabel}
        </p>
        <p className="text-body-small text-m-on-surface-variant/60 mb-5">
          Rows = hour of day (local time). Columns = days. Darker = more concurrent sessions running.
        </p>

        <div
          className="grid gap-px"
          style={{
            gridTemplateColumns: `52px repeat(${dates.length}, minmax(56px, 1fr))`,
          }}
        >
          {/* Column headers */}
          <div />
          {dates.map((d) => (
            <div
              key={d}
              className="text-label-small text-m-on-surface-variant text-center pb-2"
            >
              {formatDayHeader(d)}
            </div>
          ))}

          {/* Hour rows */}
          {hours.map((hour) => (
            <>
              <div
                key={`label-${hour}`}
                className="text-body-small text-m-on-surface-variant/50 text-right pr-2.5 flex items-center justify-end h-8"
              >
                {formatHour(hour)}
              </div>
              {dates.map((date) => {
                const cell: HeatmapCell = heatmap[date]?.[hour] ?? {
                  ai_sessions: 0,
                  human_minutes: 0,
                };
                const hasHuman = cell.human_minutes > 0;
                return (
                  <div
                    key={`${date}-${hour}`}
                    className={[
                      "h-8 rounded-sm border transition-colors relative flex items-center justify-center",
                      cellColorClass(cell.ai_sessions, summary.peak_concurrent),
                    ].join(" ")}
                    title={[
                      `${formatDayHeader(date)} ${formatHour(hour)}`,
                      `${cell.ai_sessions} concurrent session${cell.ai_sessions !== 1 ? "s" : ""}`,
                      hasHuman ? `${Math.round(cell.human_minutes)}min human time` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {cell.ai_sessions > 0 && (
                      <span className="text-[10px] font-semibold leading-none text-white/90 select-none font-mono tabular-nums">
                        {cell.ai_sessions}
                      </span>
                    )}
                    {hasHuman && (
                      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-white/60" />
                    )}
                  </div>
                );
              })}
            </>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-5 flex items-center gap-5 flex-wrap">
          <span className="text-body-small text-m-on-surface-variant/50">Intensity:</span>
          {[
            { label: "None", sessions: 0 },
            { label: "1 session", sessions: 1 },
            { label: "2 sessions", sessions: 2 },
            { label: "3+", sessions: 3 },
          ].map(({ label, sessions }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-5 h-5 rounded-sm border ${cellColorClass(sessions, 3)}`} />
              <span className="text-body-small text-m-on-surface-variant/60">{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-sm border bg-violet-500/70 relative">
              <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white/60" />
            </div>
            <span className="text-body-small text-m-on-surface-variant/60">+ human time logged</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container-high p-4">
      <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className="text-headline-small text-m-on-surface font-bold font-mono tabular-nums">{value}</p>
      <p className="text-body-small text-m-on-surface-variant/60 mt-0.5">{sub}</p>
    </div>
  );
}
