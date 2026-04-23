import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { BriefRow } from "@/components/BriefRow";
import { useBriefs } from "@/hooks/useBriefs";
import { useClients } from "@/hooks/useClients";
import { STATUS_LABEL, resumeHref, type Brief, type BriefStatus } from "@/lib/brief-routing";

const IN_PROGRESS: BriefStatus[] = ["triaged", "scoped", "quoted"];
const CLOSED: BriefStatus[] = ["accepted", "rejected", "archived", "spam"];

function HistoricRow({
  brief,
  clientName,
  interactive,
}: {
  brief: Brief;
  clientName?: string;
  interactive: boolean;
}) {
  const body = (
    <CardContent className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-title-small">{brief.raw_subject ?? "(no subject)"}</div>
        <div className="text-label-small text-m-on-surface-variant">
          {clientName ?? brief.sender_email ?? "manual"} ·{" "}
          {new Date(brief.received_at).toLocaleString("en-ZA")}
        </div>
      </div>
      <Badge variant={interactive ? "default" : "secondary"}>{STATUS_LABEL[brief.status]}</Badge>
    </CardContent>
  );
  return interactive ? (
    <Link to={resumeHref(brief)} className="block">
      <Card className="transition-colors hover:bg-m-surface-container">{body}</Card>
    </Link>
  ) : (
    <Card>{body}</Card>
  );
}

export function Inbox() {
  const { data: allBriefs = [] } = useBriefs();
  const { data: clients = [] } = useClients();
  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const byBucket = useMemo(() => {
    const buckets = {
      new: [] as Brief[],
      needs_info: [] as Brief[],
      inProgress: [] as Brief[],
      closed: [] as Brief[],
    };
    for (const b of allBriefs) {
      if (b.status === "new") buckets.new.push(b);
      else if (b.status === "needs_info") buckets.needs_info.push(b);
      else if (IN_PROGRESS.includes(b.status)) buckets.inProgress.push(b);
      else if (CLOSED.includes(b.status)) buckets.closed.push(b);
    }
    return buckets;
  }, [allBriefs]);

  const newBriefs = byBucket.new;
  const needsInfo = byBucket.needs_info;
  const inProgress = byBucket.inProgress;
  const closed = byBucket.closed;

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-headline-medium">Inbox</h1>
        <Button asChild>
          <Link to="/briefs/new">
            <Plus className="h-4 w-4" /> New brief
          </Link>
        </Button>
      </div>

      <h2 className="mb-2 text-title-medium">New ({newBriefs.length})</h2>
      <div className="space-y-2">
        {newBriefs.map((b) => <BriefRow key={b.id} brief={b} />)}
        {newBriefs.length === 0 && (
          <div className="text-body-medium text-m-on-surface-variant">Empty.</div>
        )}
      </div>

      {needsInfo.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-title-medium">Awaiting client ({needsInfo.length})</h2>
          <div className="space-y-2">
            {needsInfo.map((b) => <BriefRow key={b.id} brief={b} />)}
          </div>
        </>
      )}

      {inProgress.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-title-medium">In progress ({inProgress.length})</h2>
          <div className="space-y-2">
            {inProgress.map((b) => (
              <HistoricRow
                key={b.id}
                brief={b}
                clientName={b.client_id ? clientById.get(b.client_id) : undefined}
                interactive
              />
            ))}
          </div>
        </>
      )}

      {closed.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-title-medium">Closed ({closed.length})</h2>
          <div className="space-y-2">
            {closed.map((b) => (
              <HistoricRow
                key={b.id}
                brief={b}
                clientName={b.client_id ? clientById.get(b.client_id) : undefined}
                interactive={false}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
