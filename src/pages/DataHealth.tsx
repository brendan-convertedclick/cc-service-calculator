// Data health — "can I trust the numbers on the other pages?"
//
// Every task in the ClickUp Clients space that closed in the window, matched
// one by one against every table that may legitimately own a ClickUp task:
// briefs, provisioned retainer tasks, ongoing tasks, internal meetings and
// retainer parents. What is left is work that was done and that Conductor
// cannot see — so it is missing from Completed, from the retainer book, and
// from every report built on them.
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDataHealth, confidenceTone } from "@/hooks/useDataHealth";
import { cn, errorMessage } from "@/lib/utils";

function monthsAgoISO(n: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

export function DataHealth() {
  const [since, setSince] = useState(() => monthsAgoISO(1));
  const [includeOpen, setIncludeOpen] = useState(false);
  const run = useDataHealth();
  const data = run.data;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-headline-medium">Data health</h1>
          <p className="mt-1 max-w-2xl text-body-small text-m-on-surface-variant">
            Reads every task in the ClickUp Clients space that closed since the date
            below and matches each one against Conductor. What it cannot match is
            work that happened and that no report here can see.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Closed since"
            value={since}
            onChange={(e) => e.target.value && setSince(e.target.value)}
            className="h-10 rounded-md border border-m-outline-variant bg-transparent px-3 py-1.5 text-body-small text-m-on-surface"
          />
          <label className="flex items-center gap-2 whitespace-nowrap text-body-small text-m-on-surface-variant">
            <input
              type="checkbox"
              checked={includeOpen}
              onChange={(e) => setIncludeOpen(e.target.checked)}
              className="h-4 w-4 rounded border-m-outline"
            />
            Also check work still open
          </label>
          <Button
            onClick={() =>
              run.mutate({ since, includeOpen }, { onError: (e) => toast.error(errorMessage(e)) })
            }
            disabled={run.isPending}
          >
            <RefreshCw className={cn("h-4 w-4", run.isPending && "animate-spin")} />
            {run.isPending ? "Checking…" : "Run the check"}
          </Button>
        </div>
      </div>

      {!data && !run.isPending && (
        <div className="text-body-medium text-m-on-surface-variant">
          Nothing checked yet. It reads a few hundred ClickUp tasks, so it runs on
          the button rather than on its own.
        </div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-label-large text-m-on-surface-variant">
                  Confidence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn("font-mono text-display-small tabular-nums", confidenceTone(data.confidence))}>
                  {data.confidence}%
                </div>
                <p className="mt-1 text-label-small text-m-on-surface-variant">
                  of client work closed in ClickUp that Conductor can see
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-label-large text-m-on-surface-variant">
                  Not in Conductor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-display-small tabular-nums text-m-on-surface">
                  {data.missing.length}
                </div>
                <p className="mt-1 text-label-small text-m-on-surface-variant">
                  client tasks · {data.missing_hours}h of delivery invisible
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-label-large text-m-on-surface-variant">
                  Checked
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-display-small tabular-nums text-m-on-surface">
                  {data.clickup.closed_tasks}
                </div>
                <p className="mt-1 text-label-small text-m-on-surface-variant">
                  closed tasks · {data.clickup.client_tasks} of them client work
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-label-large text-m-on-surface-variant">
                  Last sync
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-title-medium text-m-on-surface">
                  {data.conductor.last_sync
                    ? new Date(data.conductor.last_sync).toLocaleString("en-ZA", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "never"}
                </div>
                <p className="mt-1 text-label-small text-m-on-surface-variant">
                  {data.conductor.stale_briefs} brief
                  {data.conductor.stale_briefs === 1 ? "" : "s"} more than a day old
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Internal work is counted apart and never scored: stand-ups, Monday
              status and the Ops list are created straight in ClickUp and were
              never meant to be briefs. Folding them in would peg the number at
              about 65% for ever and it would stop meaning anything. */}
          <p className="text-body-small text-m-on-surface-variant">
            {data.clickup.internal_unmatched} internal task
            {data.clickup.internal_unmatched === 1 ? " was" : "s were"} left out of the
            score — stand-ups, Monday status and the Ops list are made straight in
            ClickUp and were never meant to be briefs.
            {data.window.truncated && " The window was too large to read in full; narrow the date."}
          </p>

          <Card>
            <CardHeader>
              <CardTitle>Client work Conductor cannot see</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.missing.length === 0 ? (
                <div className="p-6 text-body-medium text-m-on-surface-variant">
                  Nothing. Every closed client task in the window is in Conductor.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>ClickUp list</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.missing.map((m) => (
                      <TableRow key={m.task_id}>
                        <TableCell className="whitespace-nowrap text-body-medium">
                          {m.client ?? (
                            <span className="text-m-on-surface-variant">list not mapped</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-body-small text-m-on-surface-variant">
                          {m.list}
                        </TableCell>
                        <TableCell className="text-body-small">
                          <a
                            href={`https://app.clickup.com/t/${m.task_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {m.name}
                          </a>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-body-small">
                          {m.points ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-body-small">
                          {m.points ? `${m.points * 0.25}h` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {data.conductor.briefed_without_task.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Briefed here, no task in ClickUp</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableBody>
                    {data.conductor.briefed_without_task.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="whitespace-nowrap text-body-medium">
                          {b.client ?? "—"}
                        </TableCell>
                        <TableCell className="text-body-small">
                          {b.subject ?? "(no subject)"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-body-small text-m-on-surface-variant">
                          {b.created_at.slice(0, 10)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {data.open && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Open work Conductor has never seen — {data.open.missing.length} of{" "}
                  {data.open.client_tasks} open client tasks
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <p className="px-6 pb-3 text-body-small text-m-on-surface-variant">
                  Work in flight rather than work delivered, so it is not missing
                  from any month yet — it is what next month's report will be wrong
                  about. Process-template folders are excluded; a client's own
                  template and project-plan lists are not, so read those rows as
                  scaffolding rather than work.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>ClickUp list</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.open.missing.slice(0, 100).map((m) => (
                      <TableRow key={m.task_id}>
                        <TableCell className="whitespace-nowrap text-body-medium">
                          {m.client ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-body-small text-m-on-surface-variant">
                          {m.list}
                        </TableCell>
                        <TableCell className="text-body-small">
                          <a
                            href={`https://app.clickup.com/t/${m.task_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {m.name}
                          </a>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-body-small">
                          {m.points ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {data.open.missing.length > 100 && (
                  <p className="px-6 py-3 text-label-small text-m-on-surface-variant">
                    Showing the 100 largest of {data.open.missing.length}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {data.unmapped_lists.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>ClickUp lists with no client behind them</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.unmapped_lists.map((l) => (
                  <Badge key={l.list_id} variant="secondary" className="whitespace-nowrap">
                    {l.name} · {l.list_id}
                  </Badge>
                ))}
                <p className="mt-2 w-full text-label-small text-m-on-surface-variant">
                  Work in these still matches by brief, but nothing that routes by
                  list knows they exist. Map them on the client's page.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
