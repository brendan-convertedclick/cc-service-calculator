import { useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Settings, Archive, ArchiveRestore, Ban, FolderPlus, Link2, FolderOpen, Zap, Inbox, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InboxAssignModal } from "@/components/scope/InboxAssignModal";
import { QuickBriefSheet, type QuickBriefSheetBrief } from "@/components/QuickBriefSheet";
import { useBriefs, useUpdateBrief, type BriefScope, type BriefFilterOptions, type BriefSortDirection } from "@/hooks/useBriefs";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useBlacklistSender } from "@/hooks/useSenderRules";
import { STATUS_LABEL } from "@/lib/brief-routing";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

type IntentType = "new_brief" | "project_thread" | "retainer_thread" | "general_query" | "quick_response";

const INTENT_LABEL: Record<IntentType, string> = {
  new_brief: "NEW",
  project_thread: "PROJECT",
  retainer_thread: "RETAINER",
  general_query: "QUERY",
  quick_response: "QUICK",
};

function IntentBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span className="inline-flex items-center gap-1 text-label-small text-m-on-surface-variant">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-m-outline" />
        pending
      </span>
    );
  }
  const label = INTENT_LABEL[type as IntentType] ?? type;
  return (
    <span className="text-label-small font-medium uppercase tracking-wide text-m-on-surface-variant">
      {label}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-ZA");
}

/** Compact leading-column date: "15 Jul", plus the year when it's not the current one. */
function briefDate(iso: string | null): { label: string; title: string } {
  if (!iso) return { label: "—", title: "" };
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return {
    label: d.toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "short",
      ...(sameYear ? {} : { year: "2-digit" }),
    }),
    title: d.toLocaleString("en-ZA"),
  };
}

const EMPTY: Record<BriefScope, string> = {
  new: "No new briefs.",
  mine: "No briefs assigned to you.",
  unassigned: "All briefs are assigned.",
  waiting: "No briefs awaiting client response.",
  all: "No briefs yet.",
  archived: "No archived briefs.",
};

interface ProjectLookupEntry {
  id: string;
  name: string | null;
  clientName: string;
}

function ProjectChip({
  project,
  hasProjectId,
  onAssignClick,
}: {
  project: ProjectLookupEntry | undefined;
  hasProjectId: boolean;
  onAssignClick: () => void;
}) {
  const navigate = useNavigate();

  if (hasProjectId && project) {
    const label = project.name ?? "Project";
    return (
      <button
        type="button"
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          navigate(`/projects/${project.id}`);
        }}
        title={`Open project · ${project.clientName} — ${label}`}
        className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-full border border-m-primary/30 bg-m-primary-container px-2 py-0.5 text-label-small font-medium text-m-on-primary-container hover:bg-m-primary/20"
      >
        <FolderOpen className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onAssignClick();
      }}
      title="Link to project"
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-m-outline-variant px-2 py-0.5 text-label-small text-m-on-surface-variant opacity-0 transition-opacity hover:border-m-primary hover:bg-m-surface-container hover:text-m-on-surface focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Link2 className="h-3 w-3" />
      Link
    </button>
  );
}

interface BriefListProps {
  scope: BriefScope;
  currentUserId?: string | null;
  selectedBriefId?: string;
  filterOptions?: BriefFilterOptions;
  sortDirection?: BriefSortDirection;
}

export function BriefList({ scope, currentUserId, selectedBriefId, filterOptions, sortDirection }: BriefListProps) {
  const { data: briefs = [], isLoading } = useBriefs(scope, currentUserId, filterOptions, sortDirection);
  const { data: clients = [] } = useClientProjects();

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectLookupEntry>();
    for (const c of clients) {
      for (const p of c.projects) {
        map.set(p.id, { id: p.id, name: p.name, clientName: c.name });
      }
    }
    return map;
  }, [clients]);

  const clientNameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  if (isLoading) {
    return (
      <div className="divide-y divide-m-outline-variant overflow-hidden rounded-lg border border-m-outline-variant bg-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-3 w-20 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="hidden h-3 w-28 shrink-0 sm:block" />
          </div>
        ))}
      </div>
    );
  }
  if (briefs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-m-outline-variant bg-card px-6 py-14 text-center">
        <Inbox className="h-6 w-6 text-m-on-surface-variant" aria-hidden />
        <p className="text-body-medium text-m-on-surface-variant">{EMPTY[scope]}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-m-outline-variant overflow-hidden rounded-lg border border-m-outline-variant bg-card">
      {briefs.map((b: Brief) => (
        <BriefRow
          key={b.id}
          brief={b}
          selected={selectedBriefId === b.id}
          project={b.parent_project_id ? projectsById.get(b.parent_project_id) : undefined}
          clientName={b.client_id ? clientNameById.get(b.client_id) : undefined}
        />
      ))}
    </div>
  );
}

function BriefRow({ brief: b, selected, project, clientName }: { brief: Brief; selected: boolean; project: ProjectLookupEntry | undefined; clientName: string | undefined }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [quickBriefOpen, setQuickBriefOpen] = useState(false);
  const { mutateAsync: updateBrief, isPending } = useUpdateBrief();
  const { mutateAsync: blacklistSender, isPending: isBlacklisting } = useBlacklistSender();
  const isArchived = b.status === "archived";
  const canBlacklist = !!b.sender_email && !!b.client_id;

  async function handleArchiveToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    try {
      await updateBrief({
        id: b.id,
        patch: { status: isArchived ? "new" : "archived" },
      });
      toast.success(isArchived ? "Brief restored" : "Brief archived");
    } catch {
      toast.error("Failed to update brief");
    }
  }

  async function handleBlacklist(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    if (!b.sender_email || !b.client_id) return;
    try {
      await blacklistSender({
        briefId: b.id,
        clientId: b.client_id,
        senderEmail: b.sender_email,
      });
      toast.success(`Blacklisted ${b.sender_email} — brief archived`);
    } catch {
      toast.error("Failed to blacklist sender");
    }
  }

  function handleTagClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    setAssignOpen(true);
  }

  function handleBriefAsIs(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    setQuickBriefOpen(true);
  }

  const showStatus = b.status !== "new" && b.status !== "archived";
  const date = briefDate(b.last_message_at ?? b.received_at);

  return (
    <>
      <Link
        to={`/inbox/${b.id}`}
        className={`group flex items-center gap-4 px-4 py-3 transition-colors ${
          selected ? "bg-m-primary-container/40" : "hover:bg-m-surface-container"
        }`}
      >
        <time
          title={date.title}
          className="flex w-20 shrink-0 items-center gap-1.5 font-mono text-label-small tabular-nums text-m-on-surface-variant"
        >
          <Calendar className="h-3.5 w-3.5 shrink-0 text-m-outline" aria-hidden />
          {date.label}
        </time>
        <div className="min-w-0 flex-1">
          <div className="truncate text-title-small">
            {b.raw_subject ?? "(no subject)"}
          </div>
          <div className="text-label-small text-m-on-surface-variant">
            {b.sender_email ?? "manual"}
            {b.message_count > 0 &&
              ` · ${b.message_count} msg${b.message_count !== 1 ? "s" : ""}`}
            {b.last_message_at && ` · ${relativeTime(b.last_message_at)}`}
          </div>
        </div>
        <div
          className="hidden w-40 shrink-0 truncate text-left text-body-small text-m-on-surface-variant sm:block"
          title={clientName ?? undefined}
        >
          {clientName ?? <span className="text-m-outline">—</span>}
        </div>
        <div className="flex w-44 shrink-0 items-center justify-end gap-2.5">
          <ProjectChip
            project={project}
            hasProjectId={!!b.parent_project_id}
            onAssignClick={() => setAssignOpen(true)}
          />
          {b.billing_type === "adhoc" && <Badge variant="warning">Adhoc</Badge>}
          {showStatus && <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>}
          <IntentBadge type={b.intent_type ?? null} />
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
                  menuOpen ? "opacity-100" : "opacity-0"
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen((o) => !o);
                }}
                aria-label="Brief actions"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-48 p-1"
                  onClick={(e) => e.preventDefault()}
                >
                  <button
                    onClick={handleArchiveToggle}
                    disabled={isPending}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-medium hover:bg-m-surface-container disabled:opacity-50"
                  >
                    {isArchived ? (
                      <>
                        <ArchiveRestore className="h-4 w-4" /> Restore
                      </>
                    ) : (
                      <>
                        <Archive className="h-4 w-4" /> Archive
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleTagClick}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-medium hover:bg-m-surface-container"
                  >
                    <FolderPlus className="h-4 w-4" /> Tag to project
                  </button>
                  <button
                    onClick={handleBriefAsIs}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-medium hover:bg-m-surface-container"
                  >
                    <Zap className="h-4 w-4" /> Brief as-is
                  </button>
                  {canBlacklist && (
                    <button
                      onClick={handleBlacklist}
                      disabled={isBlacklisting}
                      title="Block this sender for the client and archive this brief"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-medium text-m-error hover:bg-m-surface-container disabled:opacity-50"
                    >
                      <Ban className="h-4 w-4" /> Blacklist sender
                    </button>
                  )}
                </PopoverContent>
              </Popover>
          </div>
      </Link>
      {assignOpen && (
        <InboxAssignModal brief={b} open={assignOpen} onClose={() => setAssignOpen(false)} />
      )}
      <QuickBriefSheet
        open={quickBriefOpen}
        onOpenChange={setQuickBriefOpen}
        brief={{
          id: b.id,
          client_id: b.client_id,
          intent_type: b.intent_type,
          raw_subject: b.raw_subject,
          quick_task_suggestion: b.quick_task_suggestion as
            | QuickBriefSheetBrief["quick_task_suggestion"]
            | null,
          billing_type: b.billing_type as QuickBriefSheetBrief["billing_type"],
        }}
      />
    </>
  );
}
