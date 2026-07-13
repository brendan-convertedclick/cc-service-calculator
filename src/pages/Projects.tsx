import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArchiveRestore } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "@/components/ProgressRing";
import { CardActionsMenu, CardActionItem } from "@/components/CardActionsMenu";
import { useProjects, useUpdateProject } from "@/hooks/useProjects";
import { useClients } from "@/hooks/useClients";
import {
  STATUS_LABEL,
  deriveProjectStatusFromActuals,
  type DerivedStatus,
} from "@/lib/project-status";

const STATUS_ORDER: DerivedStatus[] = ["backlog", "in_progress", "complete", "cancelled", "archived"];

export function Projects() {
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const updateProject = useUpdateProject();

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
      await updateProject.mutateAsync({
        id,
        patch: { status: isArchived ? "in_progress" : "archived" },
      });
      toast.success(isArchived ? "Project restored" : "Project archived");
    } catch {
      toast.error("Failed to update project");
    }
  };

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const enriched = useMemo(
    () =>
      projects.map((p) => {
        const { status, progress } = deriveProjectStatusFromActuals(p.status, p.actuals);
        return { project: p, status, progress };
      }),
    [projects],
  );

  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<DerivedStatus>>(new Set());

  const clientOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const { project } of enriched) {
      const cid = (project as { client_id?: string | null }).client_id;
      if (cid) ids.add(cid);
    }
    return Array.from(ids)
      .map((id) => ({ id, name: clientById.get(id) ?? "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [enriched, clientById]);

  const statusOptions = useMemo(() => {
    const present = new Set<DerivedStatus>();
    for (const { status } of enriched) present.add(status);
    return STATUS_ORDER.filter((s) => present.has(s));
  }, [enriched]);

  const filtered = useMemo(
    () =>
      enriched.filter(({ project, status }) => {
        if (selectedClients.size > 0) {
          const cid = (project as { client_id?: string | null }).client_id;
          if (!cid || !selectedClients.has(cid)) return false;
        }
        if (selectedStatuses.size > 0 && !selectedStatuses.has(status)) return false;
        return true;
      }),
    [enriched, selectedClients, selectedStatuses],
  );

  const grouped = useMemo(() => {
    const buckets = new Map<DerivedStatus, typeof filtered>();
    for (const row of filtered) {
      const list = buckets.get(row.status) ?? [];
      list.push(row);
      buckets.set(row.status, list);
    }
    return STATUS_ORDER.map((status) => ({ status, rows: buckets.get(status) ?? [] }))
      .filter((g) => g.rows.length > 0);
  }, [filtered]);

  const hasFilters = selectedClients.size > 0 || selectedStatuses.size > 0;

  const toggleClient = (id: string) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleStatus = (s: DerivedStatus) => {
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
        <h1 className="text-headline-medium">Projects</h1>
        <Button asChild>
          <Link to="/projects/new">+ New Project</Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="text-body-medium text-m-on-surface-variant">
          No projects yet. Accept a brief from the Inbox to start one.
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
            {grouped.map(({ status, rows }) => (
              <section key={status} className="space-y-3">
                <h2 className="text-title-medium">
                  {STATUS_LABEL[status]} ({rows.length})
                </h2>
                <div className="space-y-2">
                  {rows.map(({ project: p, status, progress }) => {
                    const cid = (p as { client_id?: string | null }).client_id;
                    const clientName = cid ? clientById.get(cid) : undefined;
                    const showRing = progress.taskTotal > 0;
                    const ringTitle = `Tasks ${progress.taskComplete}/${progress.taskTotal} (${Math.round(progress.taskPct * 100)}%) · Hours ${progress.actualHours.toFixed(1)}/${progress.plannedHours.toFixed(1)} (${Math.round(progress.timePct * 100)}%)`;
                    return (
                      <Link to={`/projects/${p.id}`} key={p.id} className="block">
                        <Card className="transition-colors hover:bg-m-surface-container">
                          <CardContent className="flex items-center justify-between gap-4 p-4">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-title-small">
                                {(p as { name?: string }).name ?? "Untitled project"}
                              </div>
                              <div className="text-label-small text-m-on-surface-variant">
                                {clientName ? `${clientName} · ` : ""}Started{" "}
                                {new Date(p.started_at).toLocaleDateString("en-ZA")}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {showRing && (
                                <ProgressRing
                                  taskPct={progress.taskPct}
                                  timePct={progress.timePct}
                                  title={ringTitle}
                                />
                              )}
                              <Badge>{STATUS_LABEL[status]}</Badge>
                              <CardActionsMenu ariaLabel="Project actions">
                                {(close) => {
                                  const isArchived = status === "archived";
                                  return (
                                    <CardActionItem
                                      onClick={(e) => handleArchiveToggle(p.id, isArchived, e, close)}
                                      disabled={updateProject.isPending}
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
            ))}

            {hasFilters && grouped.length === 0 && (
              <div className="text-body-medium text-m-on-surface-variant">
                No projects match the current filters.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
