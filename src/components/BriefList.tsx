import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Settings, Archive, ArchiveRestore, FolderPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InboxAssignModal } from "@/components/scope/InboxAssignModal";
import { useBriefs, useUpdateBrief, type BriefScope, type BriefFilterOptions, type BriefSortDirection } from "@/hooks/useBriefs";
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
  new: "No new briefs.",
  mine: "No briefs assigned to you.",
  unassigned: "All briefs are assigned.",
  waiting: "No briefs awaiting client response.",
  all: "No briefs yet.",
  archived: "No archived briefs.",
};

interface BriefListProps {
  scope: BriefScope;
  currentUserId?: string | null;
  selectedBriefId?: string;
  filterOptions?: BriefFilterOptions;
  sortDirection?: BriefSortDirection;
}

export function BriefList({ scope, currentUserId, selectedBriefId, filterOptions, sortDirection }: BriefListProps) {
  const { data: briefs = [], isLoading } = useBriefs(scope, currentUserId, filterOptions, sortDirection);

  if (isLoading) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">Loading…</div>;
  }
  if (briefs.length === 0) {
    return <div className="text-body-medium text-m-on-surface-variant p-4">{EMPTY[scope]}</div>;
  }

  return (
    <div className="space-y-2">
      {briefs.map((b: Brief) => (
        <BriefRow key={b.id} brief={b} selected={selectedBriefId === b.id} />
      ))}
    </div>
  );
}

function BriefRow({ brief: b, selected }: { brief: Brief; selected: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const { mutateAsync: updateBrief, isPending } = useUpdateBrief();
  const isArchived = b.status === "archived";

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

  function handleTagClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    setAssignOpen(true);
  }

  return (
    <>
      <Link to={`/inbox/${b.id}`} className="block">
        <Card
          className={`transition-colors hover:bg-m-surface-container ${
            selected ? "ring-2 ring-m-primary" : ""
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
              <IntentBadge type={b.intent_type ?? null} />
              <Badge variant="secondary">{STATUS_LABEL[b.status]}</Badge>
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
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
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>
      </Link>
      {assignOpen && (
        <InboxAssignModal brief={b} open={assignOpen} onClose={() => setAssignOpen(false)} />
      )}
    </>
  );
}
