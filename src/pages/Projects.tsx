import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronRight, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterGroup, FilterOption } from "@/components/filters/FilterRail";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProgressRing } from "@/components/ProgressRing";
import { useProjects, useUpdateProject } from "@/hooks/useProjects";
import { useClients } from "@/hooks/useClients";
import {
  STATUS_LABEL,
  deriveProjectStatusFromActuals,
  type DerivedStatus,
} from "@/lib/project-status";

const STATUS_ORDER: DerivedStatus[] = ["backlog", "in_progress", "complete", "cancelled", "archived"];

export function Projects() {
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const updateProject = useUpdateProject();

  const handleArchiveToggle = async (
    id: string,
    isArchived: boolean,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
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

  const [search, setSearch] = useState("");
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<DerivedStatus>>(new Set());
  const [view, setView] = useState<"active" | "completed" | "archived">("active");
  const q = search.trim().toLowerCase();

  const archivedCount = useMemo(
    () => enriched.filter((e) => e.status === "archived").length,
    [enriched],
  );
  const completedCount = useMemo(
    () => enriched.filter((e) => e.status === "complete").length,
    [enriched],
  );

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
    // "complete" and "archived" get their own view tabs, not this filter.
    return STATUS_ORDER.filter((s) => s !== "archived" && s !== "complete" && present.has(s));
  }, [enriched]);

  const filtered = useMemo(
    () =>
      enriched.filter(({ project, status }) => {
        // Completed and archived projects each live in their own view tab.
        if (view === "archived") {
          if (status !== "archived") return false;
        } else if (view === "completed") {
          if (status !== "complete") return false;
        } else if (status === "archived" || status === "complete") {
          return false;
        }
        const cid = (project as { client_id?: string | null }).client_id;
        if (selectedClients.size > 0) {
          if (!cid || !selectedClients.has(cid)) return false;
        }
        if (selectedStatuses.size > 0 && !selectedStatuses.has(status)) return false;
        if (q) {
          const clientName = cid ? clientById.get(cid) ?? "" : "";
          const name = (project as { name?: string }).name ?? "";
          if (!`${name} ${clientName}`.toLowerCase().includes(q)) return false;
        }
        return true;
      }),
    [enriched, selectedClients, selectedStatuses, q, clientById, view],
  );

  // Collapse the client column into per-client groups (matches the Briefs list).
  const clientGroups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const row of filtered) {
      const cid = (row.project as { client_id?: string | null }).client_id;
      const key = cid ? clientById.get(cid) ?? "Unknown" : "Unassigned";
      (map.get(key) ?? map.set(key, []).get(key)!).push(row);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([clientName, rows]) => ({ clientName, rows }));
  }, [filtered, clientById]);

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
    <div className="flex h-full">
      {/* ── Left filter rail: search on top → divider → filter groups below ── */}
      <aside className="w-56 shrink-0 space-y-5 overflow-y-auto border-r border-m-outline-variant p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Search projects"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8"
          />
        </div>

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

        {clientOptions.length > 0 && (
          <FilterGroup label="Client">
            {clientOptions.map((c) => (
              <FilterOption
                key={c.id}
                label={c.name}
                active={selectedClients.has(c.id)}
                onToggle={() => toggleClient(c.id)}
              />
            ))}
          </FilterGroup>
        )}

        {statusOptions.length > 0 && (
          <FilterGroup label="Status">
            {statusOptions.map((s) => (
              <FilterOption
                key={s}
                label={STATUS_LABEL[s]}
                active={selectedStatuses.has(s)}
                onToggle={() => toggleStatus(s)}
              />
            ))}
          </FilterGroup>
        )}
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-headline-medium">Projects</h1>
            <div className="inline-flex rounded-full border border-m-outline-variant p-0.5">
              {(["active", "completed", "archived"] as const).map((v) => {
                const active = view === v;
                const label =
                  v === "active"
                    ? "Active"
                    : v === "completed"
                      ? `Completed${completedCount > 0 ? ` (${completedCount})` : ""}`
                      : `Archived${archivedCount > 0 ? ` (${archivedCount})` : ""}`;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1 text-label-large transition-colors ${
                      active
                        ? "bg-m-secondary-container text-m-on-secondary-container"
                        : "text-m-on-surface-variant hover:bg-m-surface-container"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <Button asChild>
            <Link to="/projects/new">+ New Project</Link>
          </Button>
        </div>

        {projects.length === 0 ? (
          <div className="text-body-medium text-m-on-surface-variant">
            No projects yet. Accept a brief from the Inbox to start one.
          </div>
        ) : view === "archived" && archivedCount === 0 ? (
          <div className="text-body-medium text-m-on-surface-variant">
            No archived projects. Archive one from the Active view and it moves here.
          </div>
        ) : view === "completed" && completedCount === 0 ? (
          <div className="text-body-medium text-m-on-surface-variant">
            No completed projects yet. Projects appear here once all their tasks are done.
          </div>
        ) : clientGroups.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-px" />
                  <TableHead>Name</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientGroups.map((group) => (
                  <Fragment key={group.clientName}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={5}
                        className="border-b border-m-outline-variant bg-m-surface-container-low py-2"
                      >
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="text-title-small font-semibold text-m-on-surface">
                            {group.clientName}
                          </span>
                          <span className="text-label-small text-m-on-surface-variant">
                            {group.rows.length} project{group.rows.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {group.rows.map(({ project: p, status, progress }) => {
                      const isArchived = status === "archived";
                      const showRing = progress.taskTotal > 0;
                      const ringTitle = `Tasks ${progress.taskComplete}/${progress.taskTotal} (${Math.round(progress.taskPct * 100)}%) · Hours ${progress.actualHours.toFixed(1)}/${progress.plannedHours.toFixed(1)} (${Math.round(progress.timePct * 100)}%)`;
                      return (
                        <TableRow
                          key={p.id}
                          onClick={() => navigate(`/projects/${p.id}`)}
                          className="cursor-pointer [&>td]:py-2"
                        >
                          <TableCell className="w-px pr-0 text-m-on-surface-variant">
                            <ChevronRight className="h-4 w-4" />
                          </TableCell>
                          <TableCell>
                            <div className="truncate text-body-medium text-m-on-surface">
                              {(p as { name?: string }).name ?? "Untitled project"}
                            </div>
                            <div className="text-label-small text-m-on-surface-variant">
                              Started {new Date(p.started_at).toLocaleDateString("en-ZA")}
                            </div>
                          </TableCell>
                          <TableCell>
                            {showRing ? (
                              <ProgressRing
                                taskPct={progress.taskPct}
                                timePct={progress.timePct}
                                title={ringTitle}
                              />
                            ) : (
                              <span className="text-label-small text-m-on-surface-variant">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className="whitespace-nowrap">{STATUS_LABEL[status]}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={updateProject.isPending}
                              aria-label={isArchived ? "Restore project" : "Archive project"}
                              onClick={(e) => handleArchiveToggle(p.id, isArchived, e)}
                            >
                              {isArchived ? (
                                <ArchiveRestore className="h-4 w-4" />
                              ) : (
                                <Archive className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        ) : (
          <div className="text-body-medium text-m-on-surface-variant">
            No projects match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
