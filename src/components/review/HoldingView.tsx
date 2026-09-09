import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { RunwayChart, type RunwayRow } from "@/components/signoffs/RunwayChart";
import { holdingRows, type HoldingRow } from "@/lib/client-review";
import { formatWait } from "@/lib/client-waiting";
import {
  formatDays,
  formatDueDate,
  stopClock,
  summariseStopClocks,
  type StopClock,
} from "@/lib/stop-clock";
import type { ReviewItem, ReviewWork } from "@/types/client-review";

const LONG_DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", timeZone: "UTC" };

/**
 * "Who's holding it up", the client's own copy of the tab staff argue from.
 *
 * SAME CHART, SAME ARITHMETIC — RunwayChart and stopClock, not a lookalike.
 * The whole value of showing a client this is that it is the same picture we
 * use internally; a second, gentler version drawn for them would be the first
 * thing to drift and the first thing to disbelieve.
 *
 * What changes is the VOICE. Staff read "waiting on the client"; the person
 * reading this page IS the client, so it says "you". That is why the sentence
 * is written here rather than reusing TurnaroundStatement — the numbers are
 * shared, the pronouns are not.
 *
 * Rows are built from their own items and carry no ClickUp status, url or
 * task name; `court` and the two clocks are all the chart needs.
 */
export function HoldingView({
  items,
  work,
  now,
}: {
  items: ReviewItem[];
  /** Briefed tasks that never became an ask. Titles already sanitised. */
  work?: ReviewWork[];
  now: number;
}) {
  const { rows, clocks, summary, lead } = useMemo(() => {
    // Longest-held first, because that is the conversation — and sorted on the
    // CLOCK, never on the row. An ask carries no banked total; its whole
    // elapsed time appears only once stopClock has run, so sorting the rows
    // themselves would sink every question below a task with two banked days.
    const pairs = holdingRows(items, work)
      .map((row) => ({ row, clock: stopClock(row, now) }))
      .sort(
        (a, b) =>
          b.clock.clientDays - a.clock.clientDays ||
          b.clock.ourDays - a.clock.ourDays ||
          a.row.title.localeCompare(b.row.title),
      );
    const rows: RunwayRow[] = pairs.map((p) => p.row);
    const clocks: StopClock[] = pairs.map((p) => p.clock);
    const summary = summariseStopClocks(clocks);
    const lead =
      summary.leadIndex === null
        ? null
        : { row: rows[summary.leadIndex], clock: clocks[summary.leadIndex] };
    return { rows, clocks, summary, lead };
  }, [items, work, now]);

  const open = clocks.filter((c) => c.court !== "done");
  const theirTotalMs = open.reduce((a, c) => a + c.clientMs, 0);
  const ourTotalMs = open.reduce((a, c) => a + c.internalMs, 0);

  if (rows.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-title-medium text-m-on-surface">Nothing is sitting with anyone.</p>
        <p className="mt-1 text-body-medium text-m-on-surface-variant">
          Nothing is open. Everything on your list has been settled.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-m-outline-variant px-2 py-4 lg:px-4">
        <p className="text-headline-small text-m-on-surface">
          {summary.moved > 0 ? (
            <>
              <span className="text-m-primary">{formatDays(summary.daysLost)}</span> of deadline
            </>
          ) : (
            "No deadline has moved"
          )}
        </p>
        <p className="mt-1.5 max-w-2xl text-body-medium text-m-on-surface-variant">
          {summary.moved > 0
            ? `has gone to waiting on you, across ${summary.moved} ${
                summary.moved === 1 ? "item" : "items"
              }. The clock pauses while something is with you, so those dates have moved with it.`
            : "Only our own work waiting on you moves a date, and none of it has. Anything you owe us keeps the date it was given."}
        </p>

        {lead && lead.clock.dueMs !== null && lead.clock.impliedDueMs !== null ? (
          <div className="mt-4 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-m-surface-container px-4 py-3">
            <span className="text-body-medium text-m-on-surface-variant line-through tabular-nums">
              {new Date(lead.clock.dueMs).toLocaleDateString("en-ZA", LONG_DATE)}
            </span>
            <span className="text-m-on-surface-variant">→</span>
            <span className="text-title-medium text-m-on-surface tabular-nums">
              {new Date(lead.clock.impliedDueMs).toLocaleDateString("en-ZA", LONG_DATE)}
            </span>
            <span className="ml-auto max-w-[22ch] text-right text-label-medium text-m-on-surface-variant">
              {lead.row.title.length > 34 ? `${lead.row.title.slice(0, 33)}…` : lead.row.title}
              <br />+{formatDays(lead.clock.clientDays)} paused
            </span>
          </div>
        ) : null}

        {/* Our own late rows are named to the client, not quietly dropped. A
            page that can only count their days gets believed once. */}
        {summary.lateOnUs > 0 ? (
          <p className="mt-3 text-body-medium text-m-on-surface">
            <span className="font-semibold">
              {summary.lateOnUs} {summary.lateOnUs === 1 ? "item is" : "items are"} late on us
            </span>
            , and {summary.lateOnUs === 1 ? "its date has" : "their dates have"} not moved.
          </p>
        ) : null}

        <p className="mt-3 text-label-large text-m-on-surface-variant">
          <span className="text-m-on-surface">{formatWait(theirTotalMs)}</span> with you
          {" · "}
          <span className="text-m-on-surface">{formatWait(ourTotalMs)}</span> with us
        </p>
      </div>

      <RunwayChart tasks={rows} now={now} />

      {/* Folded away by default. The chart above already answers "who is
          holding what up"; this is the ledger you open when you want the
          number on a particular line, and left open it pushed the picture off
          a laptop screen. <details> rather than a state flag: the browser
          already owns this, and it prints and finds-in-page open. */}
      <details className="group border-t border-m-outline-variant">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-3 text-title-small text-m-on-surface hover:bg-m-surface-container lg:px-4 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 text-m-on-surface-variant transition-transform group-open:rotate-90" />
          Every open item, and where its time went
          <span className="text-label-medium text-m-on-surface-variant">({rows.length})</span>
        </summary>
        <HoldingTable rows={rows} clocks={clocks} />
      </details>
    </div>
  );
}

/**
 * The rest of them, in words — the chart draws the ten that carry a date.
 *
 * Reads the clocks the view already computed rather than deriving its own. It
 * had a second copy of "their days move the date" and that is precisely the
 * arithmetic that must not be able to disagree with the picture above it.
 */
function HoldingTable({ rows, clocks }: { rows: HoldingRow[]; clocks: StopClock[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto p-2 lg:p-4">
      <table className="w-full border-collapse text-body-medium">
        <thead>
          <tr className="border-b border-m-outline-variant text-label-medium text-m-on-surface-variant">
            <th className="py-2 pr-3 text-left font-medium">Item</th>
            <th className="px-3 py-2 text-right font-medium">With you</th>
            <th className="px-3 py-2 text-right font-medium">With us</th>
            <th className="py-2 pl-3 text-right font-medium">Needed by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const c = clocks[i];
            return (
              <tr key={r.id} className="border-b border-m-outline-variant last:border-b-0">
                <td className="py-2 pr-3 text-m-on-surface">{r.title}</td>
                <td className="px-3 py-2 text-right tabular-nums text-m-on-surface-variant">
                  {c.clientDays >= 0.5 ? formatDays(c.clientDays) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-m-on-surface-variant">
                  {c.ourDays >= 0.5 ? formatDays(c.ourDays) : "—"}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {c.dueMs === null ? (
                    <span className="text-m-on-surface-variant">No date set</span>
                  ) : c.impliedDueMs !== null &&
                    // Compare the DATES, not the milliseconds: a wait of under
                    // a day moves the timestamp without moving the day, and
                    // "31 Aug 31 Aug" with one struck through reads as a bug.
                    formatDueDate(c.impliedDueMs) !== formatDueDate(c.dueMs) ? (
                    <>
                      <span className="text-m-on-surface-variant line-through">
                        {formatDueDate(c.dueMs)}
                      </span>{" "}
                      <span className="text-m-on-surface">{formatDueDate(c.impliedDueMs)}</span>
                    </>
                  ) : (
                    <span className="text-m-on-surface">{formatDueDate(c.dueMs)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
