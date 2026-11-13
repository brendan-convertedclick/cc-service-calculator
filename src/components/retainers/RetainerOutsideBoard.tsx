import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBookOutside, useRetainerOutside } from "@/hooks/useRetainerOutside";
import { formatHours as h } from "@/lib/retainer-budget";
import { canBook, OUTSIDE_KIND, OUTSIDE_REASON_LABEL, type OutsideRow } from "@/lib/retainer-outside";
import { errorMessage } from "@/lib/utils";

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Time for a retainer client that lands on none of its retainers (Brendan,
 * 2026-11-13). Hidden work is the point: until it is booked to a retainer,
 * nobody sees it against the budget and the client cannot be told they went over.
 */
export function RetainerOutsideBoard({ month }: { month: string }) {
  const { data, isLoading, isError } = useRetainerOutside(month);
  const book = useBookOutside();

  if (isLoading) return <p className="text-body-small text-m-on-surface-variant">Loading…</p>;
  if (isError || !data) return <p className="text-body-small text-m-on-surface-variant">Couldn't load work outside the retainers.</p>;

  const { clients, retainers } = data;
  const hidden = clients.reduce((s, c) => s + c.hidden, 0);
  const adhoc = clients.reduce((s, c) => s + c.adhoc, 0);

  const onBook = (row: OutsideRow, projectId: string) =>
    book.mutate(
      { row, projectId },
      {
        onSuccess: () => toast.success(`Booked to ${retainers.find((r) => r.id === projectId)?.name ?? "the retainer"}`),
        onError: (e) => toast.error(`Couldn't book it: ${errorMessage(e)}`),
      },
    );

  return (
    <div className="space-y-6">
      <p className="text-body-medium text-m-on-surface">
        {clients.length === 0
          ? `Every hour for a retainer client in ${monthLabel(month)} is booked to one of its retainers.`
          : `${h(hidden)} of work for retainer clients in ${monthLabel(month)} reaches no retainer and isn't billed as ad hoc. ${h(adhoc)} more is ad hoc and should be invoiced separately.`}
      </p>

      {clients.map((c) => {
        const options = retainers.filter((r) => r.clientId === c.clientId);
        return (
          <section key={c.clientId} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-title-medium text-m-on-surface">{c.clientName}</h3>
              <p className="font-mono text-body-small tabular-nums text-m-on-surface-variant">
                {h(c.hidden)} hidden · {h(c.adhoc)} ad hoc{c.archived > 0 && ` · ${h(c.archived)} archived`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Why it's outside</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="w-64">Book to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.rows.map((r) => (
                    <TableRow key={r.clickup_task_id}>
                      <TableCell className="min-w-[16rem] text-body-medium text-m-on-surface">
                        <a
                          href={`https://app.clickup.com/t/${r.clickup_task_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-start gap-1 hover:underline"
                        >
                          {r.task_name ?? r.clickup_task_id}
                          <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-m-on-surface-variant" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={OUTSIDE_KIND[r.reason] === "hidden" ? "destructive" : OUTSIDE_KIND[r.reason] === "adhoc" ? "warning" : "muted"}
                          className="whitespace-nowrap"
                        >
                          {OUTSIDE_REASON_LABEL[r.reason]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                        {h(Number(r.hours))}
                      </TableCell>
                      <TableCell>
                        {canBook(r) && options.length > 0 ? (
                          <Select
                            disabled={book.isPending}
                            onValueChange={(projectId) => onBook(r, projectId)}
                          >
                            <SelectTrigger aria-label={`Book ${r.task_name ?? "task"} to a retainer`}>
                              <SelectValue placeholder="Choose a retainer" />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((o) => (
                                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-body-small text-m-on-surface-variant">
                            {r.reason === "adhoc"
                              ? "Invoice it separately"
                              : r.reason === "archived"
                                ? "Reopen the brief to count it"
                                : "No retainer to book to"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}

      <p className="max-w-prose text-body-small text-m-on-surface-variant">
        Sales time is left out. So is any ClickUp task Conductor has never seen, because its client can't be told from the
        time entry yet. Calendar meetings carry no tracked time, so they don't show here and don't count in Spent either.
      </p>
    </div>
  );
}
