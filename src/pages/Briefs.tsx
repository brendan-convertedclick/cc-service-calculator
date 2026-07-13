import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArchiveRestore } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardActionsMenu, CardActionItem } from "@/components/CardActionsMenu";
import { useBriefs, useUpdateBrief } from "@/hooks/useBriefs";
import { useClients } from "@/hooks/useClients";
import { STATUS_LABEL, resumeHref, type BriefStatus } from "@/lib/brief-routing";

const IN_PROGRESS: BriefStatus[] = ["triaged", "scoped", "quoted", "accepted"];

export function Briefs() {
  const { data: allBriefs = [] } = useBriefs("all");
  const { data: clients = [] } = useClients();
  const updateBrief = useUpdateBrief();

  const handleArchiveToggle = async (
    id: string,
    isArchived: boolean,
    e: React.MouseEvent,
    close: () => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    close();
    try {
      await updateBrief.mutateAsync({
        id,
        patch: { status: isArchived ? "new" : "archived" },
      });
      toast.success(isArchived ? "Brief restored" : "Brief archived");
    } catch {
      toast.error("Failed to update brief");
    }
  };

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const inFlightAll = useMemo(
    () => allBriefs.filter((b) => IN_PROGRESS.includes(b.status as BriefStatus)),
    [allBriefs],
  );

  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<BriefStatus>>(new Set());

  const clientOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const b of inFlightAll) if (b.client_id) ids.add(b.client_id);
    return Array.from(ids)
      .map((id) => ({ id, name: clientById.get(id) ?? "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inFlightAll, clientById]);

  const statusOptions = useMemo(() => {
    const set = new Set<BriefStatus>();
    for (const b of inFlightAll) set.add(b.status as BriefStatus);
    return Array.from(set).sort();
  }, [inFlightAll]);

  const inFlight = useMemo(
    () =>
      inFlightAll.filter((b) => {
        if (selectedClients.size > 0 && (!b.client_id || !selectedClients.has(b.client_id))) {
          return false;
        }
        if (selectedStatuses.size > 0 && !selectedStatuses.has(b.status as BriefStatus)) {
          return false;
        }
        return true;
      }),
    [inFlightAll, selectedClients, selectedStatuses],
  );

  const briefedAll = useMemo(
    () => allBriefs.filter((b) => b.status === "briefed"),
    [allBriefs],
  );

  const briefed = useMemo(
    () =>
      briefedAll
        .filter((b) => {
          if (selectedClients.size > 0 && (!b.client_id || !selectedClients.has(b.client_id))) {
            return false;
          }
          return true;
        })
        .sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [briefedAll, selectedClients],
  );

  const hasFilters = selectedClients.size > 0 || selectedStatuses.size > 0;

  const toggleClient = (id: string) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleStatus = (s: BriefStatus) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  return (
    <div className="max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-headline-medium">Briefs</h1>
        <Button asChild>
          <Link to="/briefs/new">+ New Brief</Link>
        </Button>
      </div>

      {inFlightAll.length === 0 && briefedAll.length === 0 ? (
        <div className="text-body-medium text-m-on-surface-variant">
          No open briefs. New briefs land in the Inbox and become in-flight once triaged.
        </div>
      ) : (
        <div className="flex gap-8">
          <aside className="w-56 shrink-0 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-label-large text-m-on-surface">Filters</h3>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClients(new Set());
                      setSelectedStatuses(new Set());
                    }}
                    className="text-label-small text-m-primary hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {clientOptions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-label-medium text-m-on-surface-variant">Client</h4>
                <div className="space-y-2">
                  {clientOptions.map((c) => {
                    const active = selectedClients.has(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleClient(c.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-small transition-colors ${
                          active
                            ? "bg-m-secondary-container text-m-on-secondary-container"
                            : "text-m-on-surface hover:bg-m-surface-container"
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            active
                              ? "border-m-primary bg-m-primary text-m-on-primary"
                              : "border-m-outline"
                          }`}
                        >
                          {active && (
                            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="truncate">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {statusOptions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-label-medium text-m-on-surface-variant">Status</h4>
                <div className="space-y-2">
                  {statusOptions.map((s) => {
                    const active = selectedStatuses.has(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleStatus(s)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-small transition-colors ${
                          active
                            ? "bg-m-secondary-container text-m-on-secondary-container"
                            : "text-m-on-surface hover:bg-m-surface-container"
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            active
                              ? "border-m-primary bg-m-primary text-m-on-primary"
                              : "border-m-outline"
                          }`}
                        >
                          {active && (
                            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="truncate">{STATUS_LABEL[s]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>

          <div className="min-w-0 flex-1 space-y-8">
            {inFlight.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-title-medium">In progress ({inFlight.length})</h2>
                <div className="space-y-2">
                  {inFlight.map((b) => {
                    const clientName = b.client_id ? clientById.get(b.client_id) : undefined;
                    return (
                      <Link to={resumeHref(b)} key={b.id} className="block">
                        <Card className="transition-colors hover:bg-m-surface-container">
                          <CardContent className="flex items-center justify-between gap-4 p-4">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-title-small">
                                {b.raw_subject ?? "(no subject)"}
                              </div>
                              <div className="text-label-small text-m-on-surface-variant">
                                {clientName ?? b.sender_email ?? "manual"} ·{" "}
                                {new Date(b.received_at).toLocaleDateString("en-ZA")}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge>{STATUS_LABEL[b.status]}</Badge>
                              <CardActionsMenu ariaLabel="Brief actions">
                                {(close) => {
                                  const isArchived = b.status === "archived";
                                  return (
                                    <CardActionItem
                                      onClick={(e) => handleArchiveToggle(b.id, isArchived, e, close)}
                                      disabled={updateBrief.isPending}
                                      icon={
                                        isArchived ? (
                                          <ArchiveRestore className="h-4 w-4" />
                                        ) : (
                                          <Archive className="h-4 w-4" />
                                        )
                                      }
                                      label={isArchived ? "Restore" : "Archive"}
                                    />
                                  );
                                }}
                              </CardActionsMenu>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className="text-body-medium text-m-on-surface-variant">
                No briefs match the current filters.
              </div>
            )}

            {briefed.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-title-medium">Briefed ({briefed.length})</h2>
                <div className="space-y-2">
                  {briefed.map((b) => {
                    const clientName = b.client_id ? clientById.get(b.client_id) : undefined;
                    return (
                      <Card key={b.id} className="transition-colors hover:bg-m-surface-container">
                        <CardContent className="flex items-center justify-between gap-4 p-4">
                          <Link to={`/inbox/${b.id}`} className="block min-w-0 flex-1">
                            <div className="truncate text-title-small">
                              {b.raw_subject ?? "(no subject)"}
                            </div>
                            <div className="text-label-small text-m-on-surface-variant">
                              {clientName ?? b.sender_email ?? "manual"} ·{" "}
                              {new Date(b.created_at).toLocaleDateString("en-ZA")}
                            </div>
                          </Link>
                          <div className="flex shrink-0 items-center gap-3">
                            <Badge>{STATUS_LABEL[b.status]}</Badge>
                            {b.clickup_task_url && (
                              <a
                                href={b.clickup_task_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-label-small font-medium text-m-primary hover:underline"
                              >
                                View task ↗
                              </a>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
