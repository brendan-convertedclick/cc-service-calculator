// src/components/review/ItemActivity.tsx
//
// What has happened to one item, and the box to add to it. One column on the
// right of the client's page.
//
// It replaced a split: a "Messages" thread and a separate "History" panel
// behind a button. Both were the same story told twice — the thread had the
// words with no idea when the item changed hands, the history had the moves
// with none of the words, and the client had to open both and reconcile them
// by timestamp. This is the merge, and it is deliberately the SAME LIST staff
// read in ActivityPanel: same seven kinds, same icons, same shape, so a phone
// call about "the third thing on the list" means one thing to both parties.
//
// The parity has a direction. Everything on this list is on the staff one;
// internal notes, staff names and the reason someone moved a state are not on
// this one — not because this filters them out, but because the wire never
// carried them (see activityOf, and rule 1 of types/client-review.ts).
//
// Still ONE box. What pressing send DOES is carried by the buttons — Approve
// and Request changes live on the item beside this, and the page owns the
// draft so both columns see the same text. The exception is a question, which
// has no separate approval: while it is open, sending IS the answer.

import { useEffect, useRef } from "react";
import {
  CheckCircle2,
  Eye,
  FileText,
  Info,
  Mail,
  MessageSquare,
  Reply,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { activityOf, type ClientEventKind } from "@/lib/client-review";
// The formatter only — client-timeline itself is the STAFF merge and none of
// its event-building reaches this page. "31 Aug at 13:45" is the same sentence
// on both sides and does not deserve a second copy.
import { formatEventTime } from "@/lib/client-timeline";
import type { ReviewDecision, ReviewItem, ReviewOpen } from "@/types/client-review";

/** Straight off the staff panel, minus the note. Same event, same picture. */
const ICON: Record<ClientEventKind, typeof Mail> = {
  asked: FileText,
  emailed: Mail,
  opened: Eye,
  message: MessageSquare,
  replied: Reply,
  status: SlidersHorizontal,
  decided: CheckCircle2,
};

/** The line that closes a settled thread. Three asks, three outcomes. It says
 *  what happens NEXT — who decided and when is the `decided` entry's job. */
const SETTLED_LINE: Record<string, { done: string; back: string }> = {
  brief: {
    done: "Approved — thank you. We're getting on with it.",
    back: "Thanks — your notes are with us. We'll come back to you.",
  },
  question: {
    done: "Thanks — we have your answer.",
    back: "Thanks — that's with us. We'll come back to you.",
  },
  agreement: {
    done: "Marked done — thank you.",
    back: "Thanks for the update. We'll keep an eye out for it.",
  },
};

export interface ItemActivityProps {
  item: ReviewItem;
  /** Per-person link opens for this client, for the "last opened" lines. */
  opens: ReviewOpen[];
  /** The one draft, owned by the page — "Request changes" sends this too. */
  draft: string;
  onDraftChange: (value: string) => void;
  decideBusy: boolean;
  replyBusy: boolean;
  error: string | null;
  onDecide: (decision: ReviewDecision, comment?: string) => void;
  onReply: (body: string) => void;
}

export function ItemActivity({
  item,
  opens,
  draft,
  onDraftChange,
  decideBusy,
  replyBusy,
  error,
  onDecide,
  onReply,
}: ItemActivityProps) {
  const text = draft.trim();
  const busy = decideBusy || replyBusy;
  const events = activityOf(item, opens);

  const pending = item.state === "pending";
  const ours = item.owed_by === "us";
  // A question is settled by answering it — there is no separate approval, so
  // the one send button is the decision while it is open.
  const answering = pending && !ours && item.item_type === "question";

  // A list opens at the newest thing that happened, not the oldest. The column
  // has its own scroll, so without this a long history hides the reply they
  // are answering behind everything that came before it.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [item.id, events.length]);

  function send() {
    if (!text) return;
    if (answering) onDecide("approved", text);
    else onReply(text);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h2 className="text-title-small text-m-on-surface">Activity</h2>

      <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
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
                      : "bg-m-surface-container text-m-on-surface-variant",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-body-medium text-m-on-surface">{event.summary}</p>
                <p className="text-label-small text-m-on-surface-variant">
                  {formatEventTime(event.at)}
                </p>
                {event.body ? (
                  <p
                    className={cn(
                      "mt-1.5 whitespace-pre-wrap rounded-lg p-2.5 text-body-medium",
                      event.kind === "replied" || event.kind === "decided"
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

      {/* What happens next, under the list rather than in a banner above it. A
          conversation reads downward; announcing the ending first and then
          showing what led to it does not.

          Settled means decided, and an event is not — it is a date on the
          calendar, so closing it with "Approved, thank you" would announce an
          outcome to something that has none. */}
      {item.state !== "pending" && item.state !== "noted" ? (
        <p className="text-center text-label-small text-m-on-surface-variant">
          {item.item_type === "question" && item.raised_by === "client"
            ? // Their question. It closes when it is sorted — sometimes by our
              // answer above, sometimes because they sorted it themselves — so
              // the line must not promise an answer that may not be there.
              "Closed off — anything we said is above."
            : item.state === "approved"
              ? (SETTLED_LINE[item.item_type]?.done ?? SETTLED_LINE.brief.done)
              : (SETTLED_LINE[item.item_type]?.back ?? SETTLED_LINE.brief.back)}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Textarea
          rows={3}
          value={draft}
          disabled={busy}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={
            answering
              ? "Your answer…"
              : ours
                ? item.raised_by === "client"
                  ? "Anything to add?"
                  : "Need it sooner? Tell us here."
                : item.state === "noted"
                  ? "Anything we should know about this date?"
                  : "Write a reply…"
          }
        />

        <Button
          variant={answering ? "default" : "outline"}
          className="self-start"
          disabled={busy || !text}
          onClick={send}
        >
          <Send className="mr-1.5 h-4 w-4" />
          {answering ? "Send answer" : "Send"}
        </Button>

        {error ? <p className="text-label-small text-destructive">{error}</p> : null}
        <p className="flex items-start gap-1.5 text-label-small text-m-on-surface-variant opacity-80">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {answering
              ? "Sending your answer closes this off. Anything after that just comes through as a message."
              : "This comes straight to us. It's a message — it decides nothing on its own."}
          </span>
        </p>
      </div>
    </div>
  );
}
