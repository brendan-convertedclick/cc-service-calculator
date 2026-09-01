// src/components/signoffs/ActivityPanel.tsx
//
// The right-hand column: how this item has gone with the client, and the box
// to do something about it.
//
// It sits BESIDE the client preview and follows whatever item is selected in
// it, so picking a row in that queue answers "what have we actually done about
// this one" without leaving the screen. It began as a drawer opened from the
// table below; nobody found it there, because the table is under a 720px
// preview.
//
// Two things it is not. It is not ClickUp's activity feed — every field edit
// logged is a feed nobody reads, so this carries only the touch points that
// change what you would say on a call. And it is not part of the client's
// page: it is staff-side, so staff names appear freely here and never there.
//
// The composer has two modes and they are deliberately hard to confuse.
// MESSAGE emails the client on their own link and is a thing you cannot take
// back. NOTE never leaves the database. One send button whose label, colour
// and helper text all change with the mode, rather than two buttons side by
// side that a tired person picks the wrong one of.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2,
  Eye,
  Handshake,
  FileText,
  Loader2,
  Mail,
  ListPlus,
  MessageSquare,
  Reply,
  Send,
  SlidersHorizontal,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useClientContacts } from "@/hooks/useContacts";
import { useAgreementToBrief } from "@/hooks/useClientAsks";
import { useCloseOurAgreement } from "@/hooks/useClientActivity";
import { QuickBriefSheet } from "@/components/QuickBriefSheet";
import {
  ITEM_STATES,
  useAddClientNote,
  useApprovalTimeline,
  useSendClientMessage,
  useSetItemState,
  type ItemState,
} from "@/hooks/useClientActivity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatEventTime, type TimelineKind } from "@/lib/client-timeline";
import { cn, errorMessage, toggleInSet } from "@/lib/utils";

const ICON: Record<TimelineKind, typeof Mail> = {
  asked: FileText,
  emailed: Mail,
  opened: Eye,
  message: MessageSquare,
  replied: Reply,
  note: StickyNote,
  status: SlidersHorizontal,
  decided: CheckCircle2,
};

export function ActivityPanel({
  approvalId,
  clientId,
  clientName,
  title,
  /** Set for an agreement WE made and have not closed — enables the two
   *  controls only that case has: mark it done, or turn it into a task. */
  ourAgreement,
  state,
  hasItems,
  onAskQuestion,
  onRecordAgreement,
}: {
  /** The item currently selected in the preview. Undefined = nothing picked. */
  approvalId: string | undefined;
  clientId: string | undefined;
  clientName: string;
  title: string;
  ourAgreement?: { detail: string | null; dueDate: string | null; briefId: string | null } | null;
  /** The selected item's current state, for the manual override. */
  state?: ItemState;
  /**
   * Whether this client has ANY items. Without it the empty state told people
   * to "pick something from the list" when the list was empty — an instruction
   * for an impossible action, which is worse than no instruction.
   */
  hasItems: boolean;
  onAskQuestion?: () => void;
  onRecordAgreement?: () => void;
}) {
  const { data: events = [], isPending } = useApprovalTimeline(approvalId);
  const { data: contacts = [] } = useClientContacts(clientId);
  const send = useSendClientMessage();
  const note = useAddClientNote();
  const toBrief = useAgreementToBrief();
  const close = useCloseOurAgreement();
  const setState = useSetItemState();
  const [briefForSheet, setBriefForSheet] = useState<string | null>(null);

  const [mode, setMode] = useState<"message" | "note">("message");
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Reset when the selected item changes — a half-typed chase must never
  // follow the reader onto a different item and get sent about the wrong thing.
  useEffect(() => {
    setMode("message");
    setBody("");
    setPicked(new Set(contacts[0] ? [contacts[0].id] : []));
  }, [approvalId, contacts]);

  const recipients = useMemo(
    () =>
      contacts
        .filter((c) => picked.has(c.id))
        .map((c) => ({ id: c.id, email: c.email, name: c.full_name })),
    [contacts, picked],
  );

  const busy = send.isPending || note.isPending;
  const canSend =
    !!body.trim() && !busy && (mode === "note" || (recipients.length > 0 && !!clientId));

  async function submit() {
    if (!approvalId || !clientId) return;
    try {
      if (mode === "note") {
        await note.mutateAsync({ approvalId, clientId, body });
        toast.success("Note saved. It stays with us.");
      } else {
        const { failures } = await send.mutateAsync({
          approvalId,
          clientId,
          title,
          message: body,
          recipients,
        });
        if (failures.length > 0) {
          toast.warning(`Saved, but did not reach: ${failures.join("; ")}`);
        } else {
          toast.success(`Sent to ${recipients.length === 1 ? recipients[0].email : `${recipients.length} people`}.`);
        }
      }
      setBody("");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (!approvalId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        {hasItems ? (
          <p className="text-body-medium text-m-on-surface-variant">
            Pick something from {clientName}&apos;s list to see how it has gone — and to chase
            it.
          </p>
        ) : (
          <>
            <p className="text-body-medium text-m-on-surface-variant">
              Nothing has been asked of {clientName} yet, so there is no history to show.
              Start one:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" onClick={onAskQuestion}>
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Ask a question
              </Button>
              <Button size="sm" variant="outline" onClick={onRecordAgreement}>
                <Handshake className="mr-1.5 h-3.5 w-3.5" />
                Record an agreement
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
        <div className="border-b border-m-outline-variant p-4">
          <h3 className="truncate text-title-small text-m-on-surface" title={title}>
            {title}
          </h3>
          <p className="text-body-small text-m-on-surface-variant">
            How this has gone with {clientName}.
          </p>

          {/* The manual override. Statuses normally move because a client
              pressed something; this is for when they told you on the phone,
              or when something was closed by mistake. Every change writes a
              timeline row naming who moved it. */}
          {state && clientId ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-label-small text-m-on-surface-variant">Status</span>
              <Select
                value={state}
                disabled={setState.isPending}
                onValueChange={(next) => {
                  setState.mutate(
                    { approvalId: approvalId!, clientId, to: next as ItemState },
                    {
                      onSuccess: () => toast.success("Status changed. It's on the timeline."),
                      onError: (e) => toast.error(errorMessage(e)),
                    },
                  );
                }}
              >
                <SelectTrigger className="h-8 w-48" aria-label="Change status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_STATES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {ourAgreement && clientId ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={toBrief.isPending}
                onClick={async () => {
                  try {
                    // Already turned into one? Reopen that brief rather than
                    // creating a second task for one promise.
                    const briefId =
                      ourAgreement.briefId ??
                      (
                        await toBrief.mutateAsync({
                          approvalId: approvalId!,
                          clientId,
                          title,
                          detail: ourAgreement.detail,
                          dueDate: ourAgreement.dueDate,
                        })
                      ).briefId;
                    setBriefForSheet(briefId);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                <ListPlus className="mr-1.5 h-3.5 w-3.5" />
                {ourAgreement.briefId ? "Open its task" : "Turn into a task"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={close.isPending}
                onClick={async () => {
                  try {
                    await close.mutateAsync({ approvalId: approvalId! });
                    toast.success("Marked done. They'll see it on their page.");
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                We've done it
              </Button>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isPending ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-md" />
              ))}
            </div>
          ) : (
            <ol className="flex flex-col gap-4">
              {events.map((event) => {
                const Icon = ICON[event.kind];
                return (
                  <li key={event.id} className="flex gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        event.kind === "decided"
                          ? "bg-m-tertiary-container text-m-on-tertiary-container"
                          : event.kind === "replied"
                            ? "bg-m-primary-container text-m-on-primary-container"
                            : event.kind === "note"
                            ? "bg-m-surface-container-high text-m-on-surface-variant"
                            : "bg-m-surface-container text-m-on-surface-variant",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-medium text-m-on-surface">
                        {event.summary}
                        {event.actor ? (
                          <span className="text-m-on-surface-variant"> · {event.actor}</span>
                        ) : null}
                      </p>
                      <p className="text-label-small text-m-on-surface-variant">
                        {formatEventTime(event.at)}
                      </p>
                      {event.body ? (
                        <p
                          className={cn(
                            "mt-1.5 whitespace-pre-wrap rounded-lg p-2.5 text-body-medium",
                            event.kind === "note"
                              ? "bg-m-surface-container-high text-m-on-surface-variant"
                              : event.kind === "replied"
                                ? "bg-m-primary-container/40 text-m-on-surface"
                                : "bg-m-surface-container text-m-on-surface",
                          )}
                        >
                          {event.body}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="border-t border-m-outline-variant p-4">
          <div className="mb-2 flex gap-1.5">
            {(["message", "note"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-full px-3 py-1 text-label-large transition-colors",
                  mode === m
                    ? "bg-m-primary-container text-m-on-primary-container"
                    : "text-m-on-surface-variant hover:bg-m-surface-container",
                )}
              >
                {m === "message" ? "Message the client" : "Internal note"}
              </button>
            ))}
          </div>

          <Textarea
            rows={3}
            value={body}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              mode === "message"
                ? "Any news on this one? We're holding the rest of the build for it."
                : "Spoke to her at the open day — she's chasing marketing for the files."
            }
          />

          {mode === "message" ? (
            contacts.length === 0 ? (
              <p className="mt-2 text-label-small text-m-on-surface-variant">
                {clientName} has no contacts, so there is nobody to email.{" "}
                {clientId ? (
                  <Link to={`/clients/${clientId}`} className="text-m-primary underline">
                    Add them on their client page
                  </Link>
                ) : (
                  "Add them on their client page"
                )}
                . An internal note still works.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-3">
                {contacts.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-body-small">
                    <Checkbox
                      checked={picked.has(c.id)}
                      onCheckedChange={() => setPicked((prev) => toggleInSet(prev, c.id))}
                    />
                    <span className="text-m-on-surface-variant">{c.full_name ?? c.email}</span>
                  </label>
                ))}
              </div>
            )
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-label-small text-m-on-surface-variant">
              {mode === "message"
                ? "Emails each person their own link to this page."
                : "Stays with us. The client never sees it."}
            </p>
            <Button onClick={() => void submit()} disabled={!canSend}>
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : mode === "message" ? (
                <Send className="mr-1.5 h-4 w-4" />
              ) : (
                <StickyNote className="mr-1.5 h-4 w-4" />
              )}
              {mode === "message" ? "Send" : "Save note"}
            </Button>
          </div>
        </div>
      {briefForSheet && clientId ? (
        <QuickBriefSheet
          open
          onOpenChange={(v) => !v && setBriefForSheet(null)}
          brief={{
            id: briefForSheet,
            client_id: clientId,
            intent_type: null,
            raw_subject: title,
            quick_task_suggestion: null,
          }}
        />
      ) : null}
    </div>
  );
}
