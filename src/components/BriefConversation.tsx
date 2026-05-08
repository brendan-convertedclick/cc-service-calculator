import { useRef, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
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
import { useAddInternalNote, useBriefDownstream } from "@/hooks/useBriefActions";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

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
            attachments: [] as unknown[],
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
          <Button
            size="sm"
            disabled={!noteText.trim() || addNote.isPending}
            onClick={submitNote}
          >
            Add note
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
