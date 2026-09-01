// src/components/signoffs/WaitingTable.tsx
//
// The delay ledger. One row per briefed task, two clocks per row: how long it
// has sat in the client's court, and how long in ours.
//
// It exists because of an argument we keep losing. A client says the work was
// slow; we know they took three weeks to answer a question, but "we know" is
// not evidence and the conversation ends with an apology we didn't owe. Every
// minute here comes from ClickUp's own status history, so the number is
// theirs as much as ours.
//
// Closed tasks stay on the list, behind a filter. The open ones are today's
// problem; the closed ones are the pattern, and the pattern is the argument.
//
// The summary above it lives in TurnaroundStatement and the runway picture in
// RunwayChart. This is the ledger underneath both: every row, nothing elided.

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatWait, waitSplit, type Court } from "@/lib/client-waiting";
import { type WaitingTask } from "@/hooks/useClientWaiting";
import { cn } from "@/lib/utils";

const COURT_LABEL: Record<Court, string> = {
  client: "With the client",
  us: "With us",
  done: "Done",
};

function CourtBadge({ court }: { court: Court }) {
  if (court === "client") {
    return (
      <Badge className="border-transparent bg-m-primary-container text-m-on-primary-container">
        {COURT_LABEL.client}
      </Badge>
    );
  }
  if (court === "us") return <Badge variant="muted">{COURT_LABEL.us}</Badge>;
  return <Badge variant="outline">{COURT_LABEL.done}</Badge>;
}

export function WaitingTable({
  tasks,
  now,
}: {
  tasks: WaitingTask[];
  /** Passed in rather than read here, so every row on one render agrees. */
  now: number;
}) {
  const rows = useMemo(() => {
    return tasks
      .map((t) => ({ task: t, split: waitSplit(t, now) }))
      .sort((a, b) => {
        // Open before closed, then longest client-wait first: the row that
        // most needs chasing, or most needs quoting in a meeting.
        const aOpen = a.split.court !== "done";
        const bOpen = b.split.court !== "done";
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        return b.split.clientMs - a.split.clientMs;
      });
  }, [tasks, now]);

  if (rows.length === 0) {
    return (
      <p className="p-6 text-body-medium text-m-on-surface-variant">
        Nothing here. Tasks appear once they have been briefed into ClickUp and the status sync
        has run.
      </p>
    );
  }

  return (
    <>
      <table className="w-full text-body-medium">
        <thead>
          <tr className="border-b border-m-outline-variant text-label-medium text-m-on-surface-variant">
            <th className="px-6 py-2 text-left font-medium">Client</th>
            <th className="px-3 py-2 text-left font-medium">Task</th>
            <th className="px-3 py-2 text-left font-medium">Ball with</th>
            <th className="px-3 py-2 text-right font-medium">On client</th>
            <th className="px-3 py-2 text-right font-medium">On us</th>
            <th className="w-10 px-6 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, split }) => (
            <tr key={task.id} className="border-b border-m-outline-variant/60">
              <td className="px-6 py-2.5 text-m-on-surface-variant">{task.client_name}</td>
              <td className="max-w-md truncate px-3 py-2.5 text-m-on-surface" title={task.title}>
                {task.title}
              </td>
              <td className="px-3 py-2.5">
                <CourtBadge court={split.court} />
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-right tabular-nums",
                  split.court === "client" ? "text-m-on-surface" : "text-m-on-surface-variant",
                )}
              >
                {formatWait(split.clientMs)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-right tabular-nums",
                  split.court === "us" ? "text-m-on-surface" : "text-m-on-surface-variant",
                )}
              >
                {formatWait(split.internalMs)}
              </td>
              <td className="px-6 py-2.5">
                {task.clickup_task_url ? (
                  <a
                    href={task.clickup_task_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-m-on-surface-variant hover:text-m-primary"
                    aria-label="Open in ClickUp"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
