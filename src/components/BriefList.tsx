import { useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Link2, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { InboxAssignModal } from "@/components/scope/InboxAssignModal";
import { useBriefs, type BriefScope, type BriefFilterOptions } from "@/hooks/useBriefs";
import { useClientProjects } from "@/hooks/useClientProjects";
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

const INTENT_CLASS: Record<IntentType, string> = {
  new_brief: "bg-blue-100 text-blue-800",
  project_thread: "bg-purple-100 text-purple-800",
  retainer_thread: "bg-orange-100 text-orange-800",
  general_query: "bg-gray-100 text-gray-700",
  quick_response: "bg-green-100 text-green-800",
};

function IntentBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-label-small text-gray-400">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300" />
        pending
      </span>
    );
  }
  const cls = INTENT_CLASS[type as IntentType] ?? "bg-gray-100 text-gray-700";
  const label = INTENT_LABEL[type as IntentType] ?? type;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-small font-medium ${cls}`}>
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

const EMPTY: Record<BriefScope, string> = {
  mine: "No briefs assigned to you.",
  unassigned: "All briefs are assigned.",
  waiting: "No briefs awaiting client response.",
  all: "No briefs yet.",
};

interface BriefListProps {
  scope: BriefScope;
  currentUserId?: string | null;
  selectedBriefId?: string;
  filterOptions?: BriefFilterOptions;
}

interface ProjectLookupEntry {
  id: string;
  name: string | null;
  clientName: string;
}

function ProjectChip({
  brief,
  project,
  onAssignClick,
}: {
  brief: Brief;
  project: ProjectLookupEntry | undefined;
  onAssignClick: (brief: Brief) => void;
}) {
  const navigate = useNavigate();

  if (brief.parent_project_id && project) {
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
        onAssignClick(brief);
      }}
      title="Link to project"
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-m-outline-variant px-2 py-0.5 text-label-small text-m-on-surface-variant hover:border-m-primary hover:bg-m-surface-container hover:text-m-on-surface"
    >
      <Link2 className="h-3 w-3" />
      Link
    </button>
  );
}

export function BriefList({ scope, currentUserId, selectedBriefId, filterOptions }: BriefListProps) {
  const { data: briefs = [], isLoading } = useBriefs(scope, currentUserId, filterOptions);
  const { data: clients = [] } = useClientProjects();
  const [assignBrief, setAssignBrief] = useState<Brief | null>(null);

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectLookupEntry>();
    for (const c of clients) {
      for (const p of c.projects) {
        map.set(p.id, { id: p.id, name: p.name, clientName: c.name });
      }
    }
    return map;
  }, [clients]);

  if (isLoading) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">Loading…</div>;
  }
  if (briefs.length === 0) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">{EMPTY[scope]}</div>;
  }

  return (
    <>
      <div className="space-y-2">
        {briefs.map((b: Brief) => {
          const project = b.parent_project_id ? projectsById.get(b.parent_project_id) : undefined;
          return (
            <Link key={b.id} to={`/inbox/${b.id}`} className="block">
              <Card
                className={`transition-colors hover:bg-m-surface-container ${
                  selectedBriefId === b.id ? "ring-2 ring-m-primary" : ""
                }`}
              >
                <CardContent className="flex items-center justify-between gap-4 p-4">
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
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <ProjectChip
                      brief={b}
                      project={project}
                      onAssignClick={setAssignBrief}
                    />
                    <IntentBadge type={b.intent_type ?? null} />
                    <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {assignBrief && (
        <InboxAssignModal
          brief={assignBrief}
          open={!!assignBrief}
          onClose={() => setAssignBrief(null)}
        />
      )}
    </>
  );
}
