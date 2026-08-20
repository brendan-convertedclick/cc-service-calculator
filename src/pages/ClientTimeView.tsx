// /time — how many hours of our people each client actually consumed.
//
// Meetings only, and deliberately so: meeting time is the one component of
// client cost with complete coverage, because a calendar invite records
// itself. Nobody has to remember to start a timer, which is why the tracked
// hours everywhere else in Conductor read so low.
//
// The unmapped-domain queue sits ABOVE the numbers rather than in settings,
// because it is the thing that makes the numbers true. A meeting is
// attributed by the email domain of whoever else was on the invite; an
// unmapped domain is hours we spent and cannot see.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarSync, Loader2 } from "lucide-react";
import {
  useClientMeetingHours,
  useIgnoreDomain,
  useMapDomain,
  usePendingMeetingDomains,
  useSyncCalendars,
  type PendingDomainRow,
} from "@/hooks/useClientTime";
import { useClients } from "@/hooks/useClients";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/utils";

const MONTHS_SHOWN = 6;

function hrs(n: number): string {
  if (!n) return "—";
  return `${Math.round(n * 10) / 10}h`;
}

/** "2026-08" → "Aug" — the year is implied by the row of six. */
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-ZA", { month: "short" });
}

export function ClientTimeView() {
  const { data, isLoading } = useClientMeetingHours(MONTHS_SHOWN);
  const { data: pending = [], isLoading: pendingLoading } = usePendingMeetingDomains();
  const syncCalendars = useSyncCalendars();

  async function runSync(daysBack: number) {
    try {
      const res = await syncCalendars.mutateAsync({ days_back: daysBack, days_forward: 30 });
      const bits = [
        `${res.scanned} events scanned`,
        `${res.created} new`,
        `${res.updated} updated`,
      ];
      if (res.tasks_created) bits.push(`${res.tasks_created} ClickUp tasks`);
      toast.success(bits.join(" · "));
      if (res.errors.length > 0) toast.warning(res.errors[0]);
    } catch (e) {
      toast.error(`Sync failed: ${errorMessage(e)}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-headline-medium text-m-on-surface">Time per client</h1>
          <p className="mt-1 max-w-2xl text-body-medium text-m-on-surface-variant">
            Person-hours consumed by meetings, internal and client-facing alike. An hour with
            three of us in the room cost three hours. Meetings still in the diary are not counted
            until they have happened.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => runSync(14)}
            disabled={syncCalendars.isPending}
          >
            {syncCalendars.isPending
              ? <Loader2 className="mr-2 size-4 animate-spin" />
              : <CalendarSync className="mr-2 size-4" />}
            Sync calendars
          </Button>
        </div>
      </div>

      <PendingDomainsCard
        rows={pending}
        isLoading={pendingLoading}
        onResync={() => runSync(180)}
        resyncing={syncCalendars.isPending}
      />

      <Card>
        <CardHeader>
          <CardTitle>By client</CardTitle>
          <CardDescription>
            Last {MONTHS_SHOWN} months. Sorted by total hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading
            ? <Skeleton className="h-64 w-full" />
            : !data || data.rows.length === 0
            ? (
              <p className="py-8 text-center text-body-medium text-m-on-surface-variant">
                No meetings attributed yet. Run a sync, then map the domains it finds.
              </p>
            )
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-body-small">
                  <thead>
                    <tr className="border-b border-m-outline-variant text-label-medium text-m-on-surface-variant">
                      <th className="py-2 pr-4 text-left font-medium">Client</th>
                      {data.months.map((m) => (
                        <th key={m} className="px-3 py-2 text-right font-medium">{monthLabel(m)}</th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="pl-3 py-2 text-right font-medium">Client-facing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr
                        key={row.clientId}
                        className="border-b border-m-outline-variant/50 last:border-0"
                      >
                        <td className="py-2 pr-4">
                          <Link
                            to={`/clients/${row.clientId}`}
                            className="text-m-on-surface hover:underline"
                          >
                            {row.clientName}
                          </Link>
                          <span className="ml-2 text-label-small text-m-on-surface-variant">
                            {row.meetings} {row.meetings === 1 ? "meeting" : "meetings"}
                          </span>
                        </td>
                        {data.months.map((m) => (
                          <td
                            key={m}
                            className="px-3 py-2 text-right tabular-nums text-m-on-surface-variant"
                          >
                            {hrs(row.byMonth.get(m) ?? 0)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-m-on-surface">
                          {hrs(row.totalHours)}
                        </td>
                        <td className="pl-3 py-2 text-right tabular-nums text-m-on-surface-variant">
                          {hrs(row.clientMeetingHours)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-label-large text-m-on-surface">
                      <td className="pt-3">Total</td>
                      {data.months.map((m) => (
                        <td key={m} className="px-3 pt-3 text-right tabular-nums">
                          {hrs(data.rows.reduce((s, r) => s + (r.byMonth.get(m) ?? 0), 0))}
                        </td>
                      ))}
                      <td className="px-3 pt-3 text-right tabular-nums">{hrs(data.totalHours)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The domains we saw on invites and could not place, worst first.
 *
 * Ranked by the hours they would have attributed rather than by how often
 * they appear — one weekly two-hour workshop matters more than five
 * fifteen-minute check-ins, and working the list top-down recovers the most
 * time for the least clicking.
 */
function PendingDomainsCard(
  { rows, isLoading, onResync, resyncing }: {
    rows: PendingDomainRow[];
    isLoading: boolean;
    onResync: () => void;
    resyncing: boolean;
  },
) {
  const lostHours = useMemo(
    () => rows.reduce((s, r) => s + Number(r.unattributed_hours || 0), 0),
    [rows],
  );

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) return null;

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Unmapped meeting domains
          <Badge variant="secondary">{rows.length}</Badge>
          <span className="text-label-large font-normal text-amber-600">
            {hrs(lostHours)} unattributed
          </span>
        </CardTitle>
        <CardDescription>
          These people were in meetings with us and we cannot tell which client they are.
          Map one and every future meeting on that domain lands on the right client.{" "}
          Already-skipped meetings are only picked up on a later pass —{" "}
          <button
            type="button"
            onClick={onResync}
            disabled={resyncing}
            className="underline underline-offset-2 disabled:opacity-50"
          >
            re-scan the last 6 months
          </button>{" "}
          once you have mapped a few.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {rows.map((row) => <PendingDomainRowItem key={row.id} row={row} />)}
      </CardContent>
    </Card>
  );
}

function PendingDomainRowItem({ row }: { row: PendingDomainRow }) {
  const { data: clients = [] } = useClients();
  const mapDomain = useMapDomain();
  const ignoreDomain = useIgnoreDomain();
  const [clientId, setClientId] = useState<string>("");

  const busy = mapDomain.isPending || ignoreDomain.isPending;

  async function assign(id: string) {
    setClientId(id);
    try {
      await mapDomain.mutateAsync({ domain: row.domain, clientId: id });
      toast.success(`${row.domain} → ${clients.find((c) => c.id === id)?.name ?? "client"}`);
    } catch (e) {
      setClientId("");
      toast.error(`Could not map ${row.domain}: ${errorMessage(e)}`);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2 hover:bg-m-surface-container">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-medium text-m-on-surface">{row.domain}</div>
        <div className="truncate text-label-small text-m-on-surface-variant">
          {row.seen_count} {row.seen_count === 1 ? "meeting" : "meetings"} ·{" "}
          {hrs(Number(row.unattributed_hours))}
          {row.sample_title ? ` · e.g. "${row.sample_title}"` : ""}
        </div>
      </div>
      <Select value={clientId} onValueChange={assign} disabled={busy}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Assign to client…" />
        </SelectTrigger>
        <SelectContent>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => ignoreDomain.mutate(row.domain)}
      >
        Not a client
      </Button>
    </div>
  );
}
