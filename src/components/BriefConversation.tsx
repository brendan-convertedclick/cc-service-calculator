import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Link2, Unlink, Pencil, Settings, Trash2, CheckCircle2, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssigneePicker } from "@/components/AssigneePicker";
import { BriefThreadView } from "@/components/BriefThreadView";
import { BriefHandlingButtons } from "@/components/BriefHandlingButtons";
import { QuickBriefSheet, type QuickBriefSheetBrief } from "@/components/QuickBriefSheet";
import { InboxAssignModal } from "@/components/scope/InboxAssignModal";
import {
  useBriefDownstream,
  useRollbackBriefStage,
} from "@/hooks/useBriefActions";
import { useAssignBriefToProject } from "@/hooks/useAssignBriefToProject";
import { useUpdateBrief } from "@/hooks/useBriefs";
import { BILLING_LABEL, type BillingType } from "@/lib/brief-routing";
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
  const navigate = useNavigate();
  const { data: downstream } = useBriefDownstream(brief.id);
  const rollback = useRollbackBriefStage();
  const unlink = useAssignBriefToProject();
  const updateBrief = useUpdateBrief();
  const [assignOpen, setAssignOpen] = useState(false);
  const [quickBriefOpen, setQuickBriefOpen] = useState(false);

  const isLinkedToProject = downstream?.kind === "project";
  const isBriefed = brief.status === "briefed" && Boolean(brief.clickup_task_id);

  async function handleBillingChange(next: BillingType) {
    try {
      await updateBrief.mutateAsync({ id: brief.id, patch: { billing_type: next } });
      toast.success(`Billing set to ${BILLING_LABEL[next]}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update billing");
    }
  }

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

  const rollbackStage =
    downstream?.kind === "quote" || downstream?.kind === "scope"
      ? downstream.kind
      : null;

  const handleRollback = async () => {
    if (!rollbackStage) return;
    const msg =
      rollbackStage === "quote"
        ? "Delete the quote and revert this brief to the Scope stage?"
        : "Delete the scope and revert this brief to New?";
    if (!window.confirm(msg)) return;
    try {
      await rollback.mutateAsync({ briefId: brief.id, from: rollbackStage });
      toast.success(
        rollbackStage === "quote" ? "Quote deleted" : "Scope deleted",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to roll back");
    }
  };

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

  const settingsMenu = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground"
          aria-label="Brief settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-56 p-1">
        {rollbackStage ? (
          <button
            type="button"
            disabled={rollback.isPending}
            onClick={handleRollback}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body-small text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {rollbackStage === "quote" ? "Delete quote" : "Delete scope"}
          </button>
        ) : (
          <div className="px-2 py-1.5 text-body-small text-muted-foreground">
            {downstream?.kind === "project"
              ? "Project exists — cannot delete."
              : "No actions available."}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl p-0">
        <SheetHeader className="flex-shrink-0 border-b p-4">
          <SheetTitle className="text-title-medium leading-snug line-clamp-2 pr-8">
            {brief.raw_subject ?? "(no subject)"}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {brief.intent_type ? (
              <Badge className="text-label-small">
                {INTENT_LABEL[brief.intent_type] ?? brief.intent_type}
              </Badge>
            ) : (
              <Button asChild variant="outline" size="sm" className="h-7 text-label-small text-muted-foreground">
                <Link to={`/briefs/${brief.id}/scope`}>Scope pending…</Link>
              </Button>
            )}
            {brief.sender_email && (
              <Badge variant="secondary" className="text-label-small">
                {brief.sender_email}
              </Badge>
            )}
            <AssigneePicker briefId={brief.id} assigneeId={brief.assignee_id ?? null} />
            <Select
              value={brief.billing_type === "adhoc" ? "adhoc" : "retainer"}
              onValueChange={(v) => handleBillingChange(v as BillingType)}
            >
              <SelectTrigger
                aria-label="Billing"
                className="h-7 w-[110px] text-label-small"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retainer">{BILLING_LABEL.retainer}</SelectItem>
                <SelectItem value="adhoc">{BILLING_LABEL.adhoc}</SelectItem>
              </SelectContent>
            </Select>
            {linkControls}
            {isBriefed ? (
              <a
                href={brief.clickup_task_url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-full border border-m-outline-variant bg-m-surface-container px-3 py-1 text-label-small text-m-on-surface-variant hover:text-m-on-surface"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-m-primary" />
                Briefed
                <span className="inline-flex items-center gap-0.5 text-m-primary">
                  · View task
                  <ExternalLink className="h-3 w-3" />
                </span>
              </a>
            ) : (
              <BriefHandlingButtons
                brief={brief}
                onScopeIt={() => navigate(`/briefs/${brief.id}/scope`)}
                onBriefAsIs={() => setQuickBriefOpen(true)}
              />
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0">
          <BriefThreadView brief={brief} composerExtra={settingsMenu} />
        </div>

        <InboxAssignModal
          brief={brief}
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
        />

        <QuickBriefSheet
          open={quickBriefOpen}
          onOpenChange={setQuickBriefOpen}
          brief={{
            id: brief.id,
            client_id: brief.client_id,
            intent_type: brief.intent_type,
            raw_subject: brief.raw_subject,
            quick_task_suggestion: brief.quick_task_suggestion as
              | QuickBriefSheetBrief["quick_task_suggestion"]
              | null,
            billing_type: brief.billing_type as QuickBriefSheetBrief["billing_type"],
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
