// src/components/signoffs/RunwayChart.tsx
//
// The runway, and what ate it.
//
// Every row is pinned to its OWN due date, and all those due dates are drawn
// at the same x. That is the whole trick: normally each task's deadline sits
// somewhere different on a calendar and no two rows can be compared, but
// anchored this way the only thing that varies left to right is how the task
// went relative to its own promise.
//
//   LEFT of the line   the runway — the days we were given, drawn as an empty
//                      trough that FILLS as they are consumed
//   RIGHT of the line   overrun. Past its date. Written on the bar.
//   dashed tick         the stop-clock date: due + the client's days
//   far right           what is left of the overrun once their days come off
//
// An earlier version drew all the client's time to the right of the due line,
// which meant a client holding twenty days of a thirty-day window looked like
// a task that ran over rather than one whose deadline was eaten from the
// inside. The waiting now fills the runway where it actually happened.
//
// THE ORDER OF THE BANDS IS A CONVENTION, NOT A CHRONOLOGY. client_wait_ms is
// a running total with no dates on it, so we know a client held something for
// 38 days but not which 38. We draw our time first and theirs after — do a
// thing, send it, wait — because that is the usual shape. The lengths are
// real; the positions are an assumption, and the fix is keeping ClickUp's
// status_history in the sync instead of only its sums.

import { useMemo, useState } from "react";
import {
  formatDays,
  formatDueDate,
  stopClock,
  type StopClock,
} from "@/lib/stop-clock";
import type { WaitingTask } from "@/hooks/useClientWaiting";

const ROW_H = 50;
const LABEL_W = 250;
const RIGHT_W = 130;
const WIDTH = 940;
const BAR_H = 17;

/** Enough rows to read the shape; the table below carries the rest. */
const MAX_ROWS = 10;

type Row = { task: WaitingTask; clock: StopClock };

type Hover = { row: Row; x: number; y: number } | null;

function lateLabel(c: StopClock): { text: string; className: string } {
  if (c.dueMs === null) return { text: "no date", className: "fill-m-on-surface-variant" };
  if (c.lateDays > 0.05) return { text: `${formatDays(c.lateDays)} late`, className: "fill-m-error" };
  if (c.pastDueDays > 0.05) return { text: "not late", className: "fill-m-tertiary" };
  return {
    text: c.daysInHand === null ? "—" : `${formatDays(c.daysInHand)} in hand`,
    className: "fill-m-tertiary",
  };
}

export function RunwayChart({ tasks, now }: { tasks: WaitingTask[]; now: number }) {
  const [hover, setHover] = useState<Hover>(null);

  const rows = useMemo<Row[]>(
    () =>
      tasks
        .map((task) => ({ task, clock: stopClock(task, now) }))
        .filter((r) => r.clock.dueMs !== null)
        .sort((a, b) => b.clock.clientDays - a.clock.clientDays || b.clock.ourDays - a.clock.ourDays)
        .slice(0, MAX_ROWS),
    [tasks, now],
  );

  const geometry = useMemo(() => {
    const plot = WIDTH - LABEL_W - RIGHT_W;
    const back = Math.max(4, ...rows.map((r) => r.clock.runwayDays ?? 2));
    const forward = Math.max(
      4,
      ...rows.map((r) =>
        Math.max(
          r.clock.pastDueDays,
          (r.clock.impliedDueMs! - r.clock.dueMs!) / 86_400_000,
          r.clock.clientDays + r.clock.ourDays - (r.clock.runwayDays ?? 0),
          2,
        ),
      ),
    );
    const total = back + forward;
    const dueX = LABEL_W + plot * (back / total);
    return { perDay: plot / total, dueX, x: (days: number) => dueX + days * (plot / total) };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="px-6 py-5 text-body-medium text-m-on-surface-variant">
        Nothing here carries a due date, so there is no runway to draw.
      </p>
    );
  }

  const height = rows.length * ROW_H + 62;
  const { dueX, x, perDay } = geometry;

  return (
    <div className="relative px-6 py-4">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          width="100%"
          height={height}
          className="min-w-[680px]"
          role="img"
          aria-label="Each task's runway against its due date"
          onMouseLeave={() => setHover(null)}
        >
          <rect
            x={LABEL_W}
            y={26}
            width={dueX - LABEL_W}
            height={height - 58}
            className="fill-m-surface-container"
          />
          <line x1={dueX} y1={22} x2={dueX} y2={height - 34} className="stroke-m-error" strokeWidth={2} />
          <text x={dueX} y={14} textAnchor="middle" className="fill-m-error text-label-small tracking-widest">
            DUE
          </text>
          <text
            x={WIDTH - 6}
            y={14}
            textAnchor="end"
            className="fill-m-on-surface-variant text-label-small tracking-widest"
          >
            LATE BY
          </text>
          {dueX - LABEL_W > 170 ? (
            <text
              x={LABEL_W + 6}
              y={height - 11}
              className="fill-m-on-surface-variant text-label-small"
            >
              the time we were given
            </text>
          ) : null}
          <text x={dueX + 6} y={height - 11} className="fill-m-error text-label-small">
            past its date →
          </text>

          {rows.map((row, i) => {
            const c = row.clock;
            const y = 34 + i * ROW_H;
            const startDay = c.runwayDays === null ? 0 : -c.runwayDays;
            const late = lateLabel(c);

            // Consumption, filled from the start of the runway rightward.
            const bands: { width: number; className: string }[] = [];
            if (c.ourDays > 0.02) bands.push({ width: c.ourDays, className: "fill-m-tertiary" });
            if (c.clientDays > 0.02) bands.push({ width: c.clientDays, className: "fill-m-primary" });
            let cursor = startDay;

            return (
              <g key={row.task.id}>
                {c.runwayDays === null ? (
                  <text
                    x={dueX - 8}
                    y={y + 13}
                    textAnchor="end"
                    className="fill-m-on-surface-variant text-label-small tabular-nums"
                  >
                    {c.bornLate ? "born late" : "no start"}
                  </text>
                ) : (
                  <>
                    <rect
                      x={x(startDay)}
                      y={y}
                      width={dueX - x(startDay)}
                      height={BAR_H}
                      rx={2}
                      className="fill-m-surface-container-high"
                    />
                    <text
                      x={x(startDay) - 7}
                      y={y + 13}
                      textAnchor="end"
                      className="fill-m-on-surface-variant text-label-small tabular-nums"
                    >
                      {c.runwayDays}d
                    </text>
                  </>
                )}

                {bands.map((band, k) => {
                  const bx = x(cursor);
                  cursor += band.width;
                  return (
                    <rect
                      key={k}
                      x={bx}
                      y={y}
                      width={Math.max(1.5, band.width * perDay)}
                      height={BAR_H}
                      rx={2}
                      className={band.className}
                    />
                  );
                })}

                {c.runwayDays !== null && cursor > 0 ? (
                  <circle cx={dueX} cy={y + BAR_H / 2} r={3.5} className="fill-m-error" />
                ) : null}
                {cursor < 0 ? (
                  <text
                    x={x(cursor) + 6}
                    y={y + 13}
                    className="fill-m-tertiary text-label-small tabular-nums"
                  >
                    {formatDays(-cursor)} left
                  </text>
                ) : null}

                {c.pastDueDays > 0.05
                  ? (() => {
                      const text = `${formatDays(c.pastDueDays)} past due`;
                      // Only the coloured part of the overrun can carry white
                      // text. A born-late row's bar is three days long inside
                      // a twenty-eight day overrun, and centring on the
                      // overrun printed white on the pale trough.
                      const filled = Math.max(0, Math.min(cursor, c.pastDueDays));
                      return filled * perDay > 96 ? (
                        <text
                          x={dueX + (filled * perDay) / 2}
                          y={y + 13}
                          textAnchor="middle"
                          className="fill-m-on-primary text-label-small font-semibold tabular-nums"
                        >
                          {text}
                        </text>
                      ) : (
                        <text
                          x={x(Math.max(cursor, 0)) + 6}
                          y={y - 4}
                          className="fill-m-error text-label-small tabular-nums"
                        >
                          {text}
                        </text>
                      );
                    })()
                  : null}

                {c.impliedDueMs !== null && c.clientDays >= 0.5
                  ? (() => {
                      const ix = x((c.impliedDueMs! - c.dueMs!) / 86_400_000);
                      return (
                        <>
                          <line
                            x1={ix}
                            y1={y - 6}
                            x2={ix}
                            y2={y + BAR_H + 6}
                            className="stroke-m-on-surface"
                            strokeWidth={1.5}
                            strokeDasharray="3 3"
                          />
                          <text
                            x={ix}
                            y={y + BAR_H + 17}
                            textAnchor="middle"
                            className="fill-m-on-surface-variant text-label-small tabular-nums"
                          >
                            clock stops {formatDueDate(c.impliedDueMs!)}
                          </text>
                        </>
                      );
                    })()
                  : null}

                {/* Clear of the runway tick, which sits at LABEL_W - 27 on
                    the row that owns the widest runway. */}
                <text
                  x={LABEL_W - 38}
                  y={y + 13}
                  textAnchor="end"
                  className="fill-m-on-surface text-label-medium"
                >
                  {row.task.title.length > 32
                    ? `${row.task.title.slice(0, 31)}…`
                    : row.task.title}
                </text>
                <text
                  x={WIDTH - 6}
                  y={y + 13}
                  textAnchor="end"
                  className={`${late.className} text-label-medium font-semibold tabular-nums`}
                >
                  {late.text}
                </text>

                {/* One transparent hit area per row, on top of everything. */}
                <rect
                  x={4}
                  y={y - 9}
                  width={WIDTH - 8}
                  height={ROW_H - 4}
                  rx={6}
                  fill="transparent"
                  className="cursor-default"
                  onMouseMove={(e) => setHover({ row, x: e.clientX, y: e.clientY })}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {hover ? <RunwayReadout {...hover} /> : null}
    </div>
  );
}

/**
 * What we were given, and where it went. Parked over the page rather than
 * inside the <svg> — nothing in SVG lays out a definition list.
 */
function RunwayReadout({ row, x, y }: { row: Row; x: number; y: number }) {
  const c = row.clock;
  const late = lateLabel(c);
  const style = {
    left: Math.min(x + 16, window.innerWidth - 340),
    top: Math.min(y + 16, window.innerHeight - 260),
  };
  return (
    <div
      className="pointer-events-none fixed z-50 w-[300px] rounded-lg border border-m-outline-variant bg-m-surface p-4 shadow-elev-3"
      style={style}
    >
      <p className="text-title-small text-m-on-surface">{row.task.title}</p>
      <p className="mt-1 text-label-medium text-m-on-surface-variant">
        {c.runwayDays !== null ? (
          <>
            Given <span className="font-semibold text-m-on-surface">{c.runwayDays} days</span>
            {c.workHours !== null ? ` for ${c.workHours}h of work` : ""}
          </>
        ) : c.bornLate ? (
          "No runway — its date had already passed"
        ) : (
          "No due date"
        )}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_auto] justify-between gap-x-4 gap-y-1.5 text-label-large">
        {c.runwayDays !== null ? (
          <Fact swatch="bg-m-surface-container-high" k="Runway given" v={`${c.runwayDays}d`} />
        ) : null}
        {c.ourDays > 0.02 ? (
          <Fact swatch="bg-m-tertiary" k="With us" v={formatDays(c.ourDays)} />
        ) : null}
        {c.clientDays > 0.02 ? (
          <Fact swatch="bg-m-primary" k="Held by the client" v={formatDays(c.clientDays)} />
        ) : null}
        {c.daysInHand !== null && c.daysInHand > 0 ? (
          <Fact k="Runway still in hand" v={formatDays(c.daysInHand)} />
        ) : null}
        <div className="col-span-2 my-1 border-t border-m-outline-variant" />
        {c.dueMs !== null ? <Fact k="Due" v={formatDueDate(c.dueMs)} /> : null}
        {c.pastDueDays > 0.05 ? (
          <Fact k="Past its date" v={formatDays(c.pastDueDays)} />
        ) : null}
        {c.impliedDueMs !== null && c.clientDays >= 0.5 ? (
          <Fact k="Clock stops" v={formatDueDate(c.impliedDueMs)} />
        ) : null}
        <Fact k="Late by" v={late.text} />
      </dl>
    </div>
  );
}

function Fact({ swatch, k, v }: { swatch?: string; k: string; v: string }) {
  return (
    <>
      <dt className="flex items-center gap-2 text-m-on-surface-variant">
        <span className={`h-2.5 w-2.5 flex-none rounded-sm ${swatch ?? ""}`} />
        {k}
      </dt>
      <dd className="text-right font-semibold tabular-nums text-m-on-surface">{v}</dd>
    </>
  );
}
