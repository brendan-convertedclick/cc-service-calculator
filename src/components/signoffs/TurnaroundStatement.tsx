// src/components/signoffs/TurnaroundStatement.tsx
//
// The sentence, with the numbers that back it.
//
// It replaces a strip that said "54d 13h waiting on the client · 32d 22h with
// us · 62% theirs" — three true figures that nobody can act on, because a
// total for six tasks hides which one matters. What a client actually cares
// about is not the log, it is the date, so the headline is the days of
// deadline the waiting has cost and the line under it is where the earliest
// date now sits.
//
// IT HAS TO FLIP. When the delay is ours the headline says so and no date
// moves. A card that only knows how to blame the client is believed once.

import { useMemo } from "react";
import {
  formatDays,
  stopClock,
  summariseStopClocks,
  type StopClock,
} from "@/lib/stop-clock";
import { formatWait } from "@/lib/client-waiting";
import type { WaitingTask } from "@/hooks/useClientWaiting";

const LONG_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
};

export function TurnaroundStatement({
  tasks,
  now,
  clientName,
}: {
  tasks: WaitingTask[];
  now: number;
  /** Null on the all-clients view, where "you" has no referent. */
  clientName: string | null;
}) {
  const { clocks, summary, worstDue } = useMemo(() => {
    const clocks: StopClock[] = tasks.map((t) => stopClock(t, now));
    const summary = summariseStopClocks(clocks);
    const worstDue =
      summary.leadIndex === null
        ? null
        : { task: tasks[summary.leadIndex], clock: clocks[summary.leadIndex] };
    return { clocks, summary, worstDue };
  }, [tasks, now]);

  const open = clocks.filter((c) => c.court !== "done");
  const ourTotalMs = open.reduce((a, c) => a + c.internalMs, 0);
  const theirTotalMs = open.reduce((a, c) => a + c.clientMs, 0);
  const who = clientName ? "the client" : "clients";

  if (open.length === 0) {
    return (
      <div className="border-b border-m-outline-variant px-6 py-5">
        <p className="text-body-medium text-m-on-surface-variant">
          Nothing open here. The closed rows below are the record.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-m-outline-variant px-6 py-5">
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
        {summary.moved > 0 ? (
          <>
            {`has gone to waiting on ${who}, across ${summary.moved} ${
              summary.moved === 1 ? "item" : "items"
            }. The clock pauses while something is with them, so those dates have moved with it.`}
          </>
        ) : (
          `Nothing open is waiting on ${who} long enough to shift a date.`
        )}
      </p>

      {worstDue ? <DateFlip pair={worstDue} /> : null}

      {summary.lateOnUs > 0 ? (
        <p className="mt-3 text-body-medium text-m-on-surface">
          <span className="font-semibold">
            {summary.lateOnUs} {summary.lateOnUs === 1 ? "item is" : "items are"} late on us
          </span>
          , and {summary.lateOnUs === 1 ? "its date has" : "their dates have"} not moved.
        </p>
      ) : null}

      <p className="mt-3 text-label-large text-m-on-surface-variant">
        <span className="text-m-on-surface">{formatWait(theirTotalMs)}</span> waiting on{" "}
        {clientName ? "them" : "clients"}
        {" · "}
        <span className="text-m-on-surface">{formatWait(ourTotalMs)}</span> with us
      </p>
    </div>
  );
}

/** 30 July → 6 September, with the reason beside it. */
function DateFlip({ pair }: { pair: { task: WaitingTask; clock: StopClock } }) {
  const { task, clock } = pair;
  if (clock.dueMs === null || clock.impliedDueMs === null) return null;
  return (
    <div className="mt-4 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-m-surface-container px-4 py-3">
      <span className="text-body-medium text-m-on-surface-variant line-through tabular-nums">
        {new Date(clock.dueMs).toLocaleDateString("en-ZA", LONG_DATE)}
      </span>
      <span className="text-m-on-surface-variant">→</span>
      <span className="text-title-medium text-m-on-surface tabular-nums">
        {new Date(clock.impliedDueMs).toLocaleDateString("en-ZA", LONG_DATE)}
      </span>
      <span className="ml-auto max-w-[22ch] text-right text-label-medium text-m-on-surface-variant">
        {task.title.length > 34 ? `${task.title.slice(0, 33)}…` : task.title}
        <br />+{formatDays(clock.clientDays)} paused
      </span>
    </div>
  );
}
