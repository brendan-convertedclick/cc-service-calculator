import { Fragment, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentUserId } from "@/context/AuthContext";
import {
  useBookOutside,
  useConvertOutsideToAdhoc,
  useDismissOutside,
  useRetainerOutside,
  type RetainerOption,
} from "@/hooks/useRetainerOutside";
import { formatHours as h } from "@/lib/retainer-budget";
import {
  canBook,
  canConvertToAdhoc,
  isHidden,
  OUTSIDE_COLUMN,
  OUTSIDE_REASON_LABEL,
  totalOutside,
  type DismissKind,
  type OutsideRow,
  type OutsideTotals,
} from "@/lib/retainer-outside";
import { cn, errorMessage, toggleInSet } from "@/lib/utils";

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const num = (n: number) => (n > 0 ? h(n) : "–");

/** The figures every client row and the total row share, leaks first. */
function Figures({ t, strong }: { t: OutsideTotals; strong?: boolean }) {
  const cell = "text-right font-mono tabular-nums text-body-medium";
  return (
    <>
      <TableCell className={cn(cell, "text-m-on-surface-variant")}>
        {num(t.internal)}
      </TableCell>
      <TableCell className={cn(cell, "text-m-on-surface-variant")}>
        {num(t.meeting)}
      </TableCell>
      <TableCell className={cn(cell, "text-m-on-surface-variant")}>
        {num(t.other)}
      </TableCell>
      <TableCell
        className={cn(
          cell,
          t.hidden > 0
            ? "font-semibold text-m-error"
            : "text-m-on-surface-variant",
        )}
      >
        {num(t.hidden)}
      </TableCell>
      <TableCell
        className={cn(
          cell,
          "border-l border-m-outline-variant",
          strong ? "text-m-on-surface" : "text-m-on-surface-variant",
        )}
      >
        {num(t.adhoc)}
      </TableCell>
    </>
  );
}

/**
 * Time for a retainer client that lands on none of its retainers (Brendan and
 * Lisa, 2026-11-13). One row per client, worst leak first, collapsed: the leaks
 * (Internal, meeting, other) sum to Hidden, which is time lost unless booked;
 * ad hoc sits apart because it is billable and only needs invoicing. Each task
 * carries its own fix where you find it.
 */
export function RetainerOutsideBoard({ month }: { month: string }) {
  const { data, isLoading, isError } = useRetainerOutside(month);
  const book = useBookOutside();
  const convert = useConvertOutsideToAdhoc();
  const dismiss = useDismissOutside();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const canDismiss = useCurrentUserId() != null;

  if (isLoading)
    return (
      <p className="text-body-small text-m-on-surface-variant">Loading…</p>
    );
  if (isError || !data)
    return (
      <p className="text-body-small text-m-on-surface-variant">
        Couldn't load work outside the retainers.
      </p>
    );

  const { clients, retainers } = data;
  const total = totalOutside(clients);
  const busy = book.isPending || convert.isPending || dismiss.isPending;

  const onBook = (row: OutsideRow, projectId: string) =>
    book.mutate(
      { row, projectId },
      {
        onSuccess: () =>
          toast.success(
            `Booked to ${retainers.find((r) => r.id === projectId)?.name ?? "the retainer"}`,
          ),
        onError: (e) => toast.error(`Couldn't book it: ${errorMessage(e)}`),
      },
    );
  const onConvert = (row: OutsideRow) =>
    convert.mutate(row, {
      onSuccess: () => toast.success("Converted to ad hoc, in ClickUp too"),
      onError: (e) => toast.error(`Couldn't convert it: ${errorMessage(e)}`),
    });
  /** Confirm as ours or as sales, or with no kind, Undo. */
  const onDismiss = (row: OutsideRow, kind?: DismissKind) =>
    dismiss.mutate(
      { row, kind, undo: !kind },
      {
        onSuccess: () =>
          toast.success(
            !kind ? "Back on the report" : kind === "sales" ? "Marked as sales" : "Confirmed as internal",
          ),
        onError: (e) => toast.error(`Couldn't save that: ${errorMessage(e)}`),
      },
    );

  if (clients.length === 0) {
    return (
      <p className="text-body-medium text-m-on-surface">
        Every hour for a retainer client in {monthLabel(month)} is booked to one
        of its retainers.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-body-medium text-m-on-surface">
        {h(total.hidden)} of work for retainer clients in {monthLabel(month)}{" "}
        reaches no retainer and isn't billed. {h(total.adhoc)} more is ad hoc
        and needs invoicing.
      </p>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Marked Internal</TableHead>
              <TableHead className="text-right">Meeting, no retainer</TableHead>
              <TableHead className="text-right">Other, no retainer</TableHead>
              <TableHead className="text-right">Hidden, still to fix</TableHead>
              <TableHead className="border-l border-m-outline-variant text-right">
                Ad hoc
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => {
              const expanded = open.has(c.clientId);
              const options = retainers.filter(
                (r) => r.clientId === c.clientId,
              );
              return (
                <Fragment key={c.clientId}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setOpen((s) => toggleInSet(s, c.clientId))}
                    aria-expanded={expanded}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 shrink-0 text-m-on-surface-variant transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                        <span className="text-label-large text-m-on-surface">
                          {c.clientName}
                        </span>
                      </div>
                      {(c.dismissed > 0 || c.sales > 0 || c.archived > 0) && (
                        <p className="pl-6 text-label-small text-m-on-surface-variant">
                          {[
                            c.dismissed > 0 && `Dismissed: ${h(c.dismissed)}`,
                            c.sales > 0 && `Sales: ${h(c.sales)}`,
                            c.archived > 0 &&
                              `Archived briefs: ${h(c.archived)}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </TableCell>
                    <Figures t={c} />
                  </TableRow>
                  {expanded && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={6}
                        className="bg-m-surface-container-low p-0"
                      >
                        <TaskList
                          rows={c.rows}
                          options={options}
                          busy={busy}
                          canDismiss={canDismiss}
                          onBook={onBook}
                          onConvert={onConvert}
                          onDismiss={onDismiss}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            <TableRow className="hover:bg-transparent">
              <TableCell className="text-label-large text-m-on-surface">
                Total
                {(total.dismissed > 0 || total.sales > 0) && (
                  <p className="text-label-small text-m-on-surface-variant">
                    {[
                      total.dismissed > 0 && `Dismissed: ${h(total.dismissed)}`,
                      total.sales > 0 && `Sales: ${h(total.sales)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </TableCell>
              <Figures t={total} strong />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p className="max-w-prose text-body-small text-m-on-surface-variant">
        The first three columns show all the month's time. Hidden is what is
        left of it once confirmed-internal time comes off: time nobody bills
        unless it's booked to a retainer. Archived briefs are listed for
        reference and not counted in Hidden: reopen the brief to count it. Sales
        time is left out, and so is any ClickUp task Conductor has never seen.
      </p>
    </div>
  );
}

/** Expanded rows in blocks: the ones to fix first, then what only needs invoicing, then the record. */
const BLOCKS: Array<{ label: string; has: (r: OutsideRow) => boolean }> = [
  { label: "Needs fixing", has: (r) => isHidden(r) && !r.dismissed_at },
  {
    label: "Ad hoc, invoiced separately",
    has: (r) => !r.dismissed_at && OUTSIDE_COLUMN[r.reason] === "adhoc",
  },
  {
    label: "Confirmed internal",
    has: (r) => Boolean(r.dismissed_at) && r.dismissed_kind !== "sales",
  },
  {
    label: "Marked as sales",
    has: (r) => Boolean(r.dismissed_at) && r.dismissed_kind === "sales",
  },
  {
    label: "Archived briefs",
    has: (r) => !r.dismissed_at && r.reason === "archived",
  },
];

function TaskList({
  rows,
  options,
  busy,
  canDismiss,
  onBook,
  onConvert,
  onDismiss,
}: {
  rows: OutsideRow[];
  options: RetainerOption[];
  busy: boolean;
  canDismiss: boolean;
  onBook: (row: OutsideRow, projectId: string) => void;
  onConvert: (row: OutsideRow) => void;
  onDismiss: (row: OutsideRow, kind?: DismissKind) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-10">Task</TableHead>
          <TableHead>Why it's outside</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead className="min-w-[22rem]">Fix it</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {BLOCKS.map((b) => {
          const block = rows.filter(b.has);
          if (block.length === 0) return null;
          return (
            <Fragment key={b.label}>
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={4}
                  className="pl-10 pt-4 text-label-medium text-m-on-surface-variant"
                >
                  {b.label}
                </TableCell>
              </TableRow>
              {block.map((r) => (
                <TableRow
                  key={r.clickup_task_id}
                  className={cn(
                    "hover:bg-transparent",
                    r.dismissed_at && "opacity-60",
                  )}
                >
                  <TableCell className="min-w-[16rem] pl-10 text-body-medium text-m-on-surface">
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
                      variant={
                        r.dismissed_at
                          ? "muted"
                          : isHidden(r)
                            ? "destructive"
                            : OUTSIDE_COLUMN[r.reason] === "adhoc"
                              ? "warning"
                              : "muted"
                      }
                      className="whitespace-nowrap"
                    >
                      {OUTSIDE_REASON_LABEL[r.reason]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                    {h(Number(r.hours))}
                  </TableCell>
                  <TableCell>
                    {r.dismissed_at ? (
                      <div className="flex flex-wrap items-center gap-2 text-body-small text-m-on-surface-variant">
                        <span>
                          {r.dismissed_kind === "sales"
                            ? "Marked as sales"
                            : "Confirmed internal"}{" "}
                          by{" "}
                          {r.dismissed_by_name ?? "someone"},{" "}
                          {new Date(r.dismissed_at).toLocaleDateString(
                            "en-ZA",
                            { day: "numeric", month: "short" },
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => onDismiss(r)}
                        >
                          Undo
                        </Button>
                      </div>
                    ) : canBook(r) ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {/* A brief goes ad hoc by Convert, the route the ad hoc invoice reads
                      (billing_type adhoc, no parent project). The open retainer is
                      only offered to meetings and buckets, which cannot convert. */}
                        {(r.brief_id ? options.filter((o) => !o.open) : options)
                          .length > 0 && (
                          <Select
                            disabled={busy}
                            onValueChange={(projectId) => onBook(r, projectId)}
                          >
                            <SelectTrigger
                              className="w-56"
                              aria-label={`Book ${r.task_name ?? "task"} to a retainer`}
                            >
                              <SelectValue
                                placeholder={
                                  r.reason === "clickup_only"
                                    ? "Create brief on a retainer"
                                    : "Book to a retainer"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {(r.brief_id
                                ? options.filter((o) => !o.open)
                                : options
                              ).map((o) => (
                                <SelectItem key={o.id} value={o.id}>
                                  {o.open
                                    ? `${o.name} (no budget, invoiced)`
                                    : o.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {canConvertToAdhoc(r) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => onConvert(r)}
                          >
                            Convert to ad hoc
                          </Button>
                        )}
                        {canDismiss ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => onDismiss(r, "internal")}
                            >
                              Confirm internal
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => onDismiss(r, "sales")}
                            >
                              Mark as sales
                            </Button>
                          </>
                        ) : (
                          <span className="text-body-small text-m-on-surface-variant">
                            Sign in as yourself to confirm internal or mark as sales
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-body-small text-m-on-surface-variant">
                        {OUTSIDE_COLUMN[r.reason] === "adhoc"
                          ? "Invoice it separately"
                          : r.reason === "archived"
                            ? "Reopen the brief to count it"
                            : "No Conductor record to change"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
