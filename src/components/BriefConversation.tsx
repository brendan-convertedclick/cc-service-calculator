import { useState } from "react";
import { Link } from "react-router-dom";
import { X, Link2, Unlink, Pencil } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AssigneePicker } from "@/components/AssigneePicker";
import { BriefThreadView } from "@/components/BriefThreadView";
import { InboxAssignModal } from "@/components/scope/InboxAssignModal";
import { useBriefDownstream } from "@/hooks/useBriefActions";
import { useAssignBriefToProject } from "@/hooks/useAssignBriefToProject";
import { toast } from "sonner";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const INTENT_LABEL: Record<string, string> = {
  new_brief: "New brief",
  project_thread: "Project thread",
  retainer_thread: "Retainer",
  general_query: "General query",
  quick_response: "Quick response",
};

interface BriefConversationProps {
  brief: Brief;
  open: boolean;
  onClose: () => void;
}

export function BriefConversation({ brief, open, onClose }: BriefConversationProps) {
  const { data: downstream } = useBriefDownstream(brief.id);
  const unlink = useAssignBriefToProject();
  const [assignOpen, setAssignOpen] = useState(false);

  const isLinkedToProject = downstream?.kind === "project";

  async function handleUnlink() {
    try {
      await unlink.mutateAsync({
        briefId: brief.id,
        projectId: null,
        previousProjectId: brief.parent_project_id ?? null,
      });
      toast.success("Unlinked from project");
    } catch {
      toast.error("Failed to unlink");
    }
  }

  const linkControls = isLinkedToProject ? (
    <div className="flex items-center gap-1">
      <Button asChild variant="outline" size="sm" className="h-7 text-label-small">
        <Link to={`/projects/${downstream!.id}`}>Project →</Link>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Change project"
        onClick={() => setAssignOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Unlink from project"
        disabled={unlink.isPending}
        onClick={handleUnlink}
      >
        <Unlink className="h-3.5 w-3.5" />
      </Button>
    </div>
  ) : downstream && downstream.kind !== "none" ? (
    <Button asChild variant="outline" size="sm" className="h-7 text-label-small">
      <Link to={downstream.kind === "quote" ? `/quotes/${downstream.id}` : `/briefs/${brief.id}/scope`}>
        {downstream.kind === "quote" ? "Quote" : "Scope"} →
      </Link>
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-label-small"
      onClick={() => setAssignOpen(true)}
    >
      <Link2 className="h-3.5 w-3.5" />
      Link to project
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl p-0">
        <SheetHeader className="flex-shrink-0 border-b p-4">
          <div className="flex items-start justify-between gap-2">
            <SheetTitle className="text-title-medium leading-snug line-clamp-2">
              {brief.raw_subject ?? "(no subject)"}
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {brief.intent_type ? (
              <Badge className="text-label-small">
                {INTENT_LABEL[brief.intent_type] ?? brief.intent_type}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-label-small text-muted-foreground">
                Scope pending…
              </Badge>
            )}
            {brief.sender_email && (
              <Badge variant="secondary" className="text-label-small">
                {brief.sender_email}
              </Badge>
            )}
            <AssigneePicker briefId={brief.id} assigneeId={brief.assignee_id ?? null} />
            {linkControls}
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0">
          <BriefThreadView brief={brief} />
        </div>

        <InboxAssignModal
          brief={brief}
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
