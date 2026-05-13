import { useRef, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Settings, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AssigneePicker } from "@/components/AssigneePicker";
import { MessageItem } from "@/components/MessageItem";
import { useBriefMessages } from "@/hooks/useBriefMessages";
import {
  useAddInternalNote,
  useBriefDownstream,
  useRollbackBriefStage,
} from "@/hooks/useBriefActions";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import type { Database } from "@/types/db";
import type { Json } from "@/types/db";

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
  const { user } = useAuth();
  const { data: messages = [], isLoading } = useBriefMessages(brief.id);
  const addNote = useAddInternalNote(brief.id);
  const { data: downstream } = useBriefDownstream(brief.id);
  const rollback = useRollbackBriefStage();
  const [noteText, setNoteText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Synthesize a message from raw_body for legacy manual briefs with no messages
  const displayMessages =
    messages.length > 0
      ? messages
      : brief.raw_body
      ? [
          {
            id: "synthetic",
            brief_id: brief.id,
            gmail_message_id: "synthetic",
            direction: "inbound" as const,
            from_email: brief.sender_email,
            from_name: null,
            to_emails: [] as string[],
            cc_emails: [] as string[],
            subject: brief.raw_subject,
            body_text: brief.raw_body,
            body_html: null,
            attachments: [] as Json[],
            sent_at: brief.received_at,
            relayed_by: null,
            created_at: brief.received_at,
          },
        ]
      : [];

  const submitNote = async () => {
    const body = noteText.trim();
    if (!body || !user?.email) return;
    try {
      await addNote.mutateAsync({ body, authorEmail: user.email });
      setNoteText("");
    } catch {
      toast.error("Failed to save note");
    }
  };

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

  const downstreamChip =
    downstream && downstream.kind !== "none" ? (
      <Button asChild variant="outline" size="sm" className="h-7 text-label-small">
        <Link
          to={
            downstream.kind === "project"
              ? `/projects/${downstream.id}`
              : downstream.kind === "quote"
              ? `/quotes/${downstream.id}`
              : `/briefs/${brief.id}/scope`
          }
        >
          {downstream.kind === "project"
            ? "Project"
            : downstream.kind === "quote"
            ? "Quote"
            : "Scope"}{" "}
          →
        </Link>
      </Button>
    ) : null;

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
            {downstreamChip}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {brief.intent_type === "quick_response" && brief.draft_reply && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-label-small font-medium text-green-800">Draft reply</span>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-label-small text-green-700 hover:bg-green-100"
                  onClick={() => {
                    navigator.clipboard.writeText(brief.draft_reply!);
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
              <p className="whitespace-pre-wrap text-body-small text-green-900">
                {brief.draft_reply}
              </p>
            </div>
          )}
          {isLoading && (
            <div className="text-body-medium text-m-on-surface-variant">Loading…</div>
          )}
          {!isLoading &&
            displayMessages.map((m) => (
              <MessageItem key={m.id} message={m} />
            ))}
          <div ref={bottomRef} />
        </div>

        <div className="flex-shrink-0 border-t p-4 space-y-2">
          <textarea
            placeholder="Add an internal note…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-body-medium ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              disabled={!noteText.trim() || addNote.isPending}
              onClick={submitNote}
            >
              Add note
            </Button>
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
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
