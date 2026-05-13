import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageItem } from "@/components/MessageItem";
import { useBriefMessages } from "@/hooks/useBriefMessages";
import { useAddInternalNote } from "@/hooks/useBriefActions";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import type { Database, Json } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

interface BriefThreadViewProps {
  brief: Brief;
  showComposer?: boolean;
  autoScroll?: boolean;
}

export function BriefThreadView({
  brief,
  showComposer = true,
  autoScroll = true,
}: BriefThreadViewProps) {
  const { user } = useAuth();
  const { data: messages = [], isLoading } = useBriefMessages(brief.id);
  const addNote = useAddInternalNote(brief.id);
  const [noteText, setNoteText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, autoScroll]);

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

  return (
    <div className="flex h-full flex-col">
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
          displayMessages.map((m) => <MessageItem key={m.id} message={m} />)}
        <div ref={bottomRef} />
      </div>

      {showComposer && (
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
      )}
    </div>
  );
}
