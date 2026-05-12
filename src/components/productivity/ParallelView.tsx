// src/components/productivity/ParallelView.tsx
import { ParallelData, ParallelSession } from "@/hooks/useOutputMultiplier";

const PROJECT_COLORS: Record<string, string> = {
  "cc-service-calculator": "bg-violet-900/40 border-violet-600/40 text-violet-300",
  granite: "bg-cyan-900/40 border-cyan-600/40 text-cyan-300",
  pebble: "bg-emerald-900/40 border-emerald-600/40 text-emerald-300",
  intake: "bg-amber-900/40 border-amber-600/40 text-amber-300",
};

const DEFAULT_COLOR = "bg-slate-800/60 border-slate-600/40 text-slate-300";

function sessionColor(slug: string): string {
  return PROJECT_COLORS[slug] ?? DEFAULT_COLOR;
}

const MAX_SLOTS = 6;

interface Props {
  data: ParallelData;
}

export function ParallelView({ data }: Props) {
  const { days, summary, periodLabel } = data;

  const maxSlots = Math.min(
    Math.max(...days.map((d) => d.sessions.length), 1),
    MAX_SLOTS,
  );

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3">
        <Chip
          label="Avg Concurrent Sessions"
          value={`${summary.avg_concurrent}×`}
          sub={periodLabel}
        />
        <Chip
          label="Peak Sessions"
          value={String(summary.peak_concurrent)}
          sub="in one wall-clock period"
        />
        <Chip
          label="Parallel Output Hours"
          value={`${summary.parallel_output_hours}h`}
          sub={`from ${summary.wall_clock_hours}h wall-clock`}
        />
      </div>

      {/* Concurrency grid */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
          Session concurrency — {periodLabel}
        </p>
        <p className="text-body-small text-m-on-surface-variant/60 mb-5">
          Each column = one day. Rows = simultaneous Claude sessions. More filled rows = higher
          parallel multiplier.
        </p>

        {days.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant/40 text-center py-12">
            No sessions logged for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `80px repeat(${days.length}, minmax(80px, 1fr))`,
                gridTemplateRows: `auto ${Array.from({ length: maxSlots }, () => "36px").join(" ")}`,
              }}
            >
              {/* Column headers */}
              <div />
              {days.map((day) => (
                <div
                  key={day.date}
                  className="text-label-small text-m-on-surface-variant text-center pb-1.5"
                >
                  {new Date(day.date).toLocaleDateString("en-ZA", {
                    weekday: "short",
                    day: "numeric",
                  })}
                </div>
              ))}

              {/* Session rows */}
              {Array.from({ length: maxSlots }, (_, slotIdx) => (
                <>
                  <div
                    key={`label-${slotIdx}`}
                    className="text-body-small text-m-on-surface-variant/60 flex items-center"
                  >
                    Session {slotIdx + 1}
                  </div>
                  {days.map((day) => {
                    const session: ParallelSession | undefined = day.sessions[slotIdx];
                    return (
                      <div
                        key={`${day.date}-${slotIdx}`}
                        className={[
                          "rounded-md border flex items-center justify-center text-[10px] font-semibold h-9",
                          session
                            ? sessionColor(session.project_slug)
                            : "bg-m-surface-container-high border-m-outline-variant/30",
                        ].join(" ")}
                        title={
                          session
                            ? `${session.project_slug} — ${Math.round(session.duration_minutes)}min`
                            : undefined
                        }
                      >
                        {session
                          ? session.project_slug.split("-")[0].slice(0, 6)
                          : ""}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        )}

        {days.length > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-m-primary/30 bg-m-primary/10 px-3 py-1.5 text-body-small text-m-primary font-semibold">
            ⚡ Period avg: {summary.avg_concurrent}× parallel — equivalent to{" "}
            {summary.avg_concurrent}× people working simultaneously
          </div>
        )}
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
      <p className="text-headline-small text-m-on-surface font-bold">{value}</p>
      <p className="text-body-small text-m-on-surface-variant/60 mt-0.5">{sub}</p>
    </div>
  );
}
