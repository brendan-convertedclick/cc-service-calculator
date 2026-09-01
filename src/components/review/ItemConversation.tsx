// src/components/review/ItemConversation.tsx
//
// One thread, one box.
//
// This replaces a split that confused people: the ask sat in its own section
// with its own "Your answer" textarea and Send, and underneath it a SECOND
// textarea and Send for "Talk to us about this". Two boxes side by side that
// settled different things — a client had no way to know which one to type in,
// and the wrong guess either signed something off or failed to.
//
// So: the ask is the first message in the thread, everything since follows it
// in order, and there is exactly one place to type. What pressing send DOES is
// carried by the buttons, which is where a consequence belongs — never by
// which of two identical boxes you happened to land in.
//
// The decision is still a decision. Approving is a button, not a message; a
// message is a message. The one box serves both because a decision that needs
// words (request changes, an answer) needs the same words a message does.

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { threadOf } from "@/lib/client-review";
import type { ReviewDecision, ReviewItem } from "@/types/client-review";

/** "31 Aug at 13:45", local time — they are reading it where they are. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} at ${d.toLocaleTimeString(
    "en-ZA",
    { hour: "2-digit", minute: "2-digit", hour12: false },
  )}`;
}

/** The line that closes a settled thread. Three asks, three outcomes. */
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

/** "31 Aug at 14:35" for the closing line. */
function settledAt(item: ReviewItem): string {
  return item.decided_at ? when(item.decided_at) : "";
}

export interface ItemConversationProps {
  item: ReviewItem;
  /** Their own name, for their bubbles. Null on a legacy shared link. */
  youAre: string | null;
  decideBusy: boolean;
  replyBusy: boolean;
  error: string | null;
  onDecide: (decision: ReviewDecision, comment?: string) => void;
  onReply: (body: string) => void;
}

export function ItemConversation({
  item,
  youAre,
  decideBusy,
  replyBusy,
  error,
  onDecide,
  onReply,
}: ItemConversationProps) {
  const [draft, setDraft] = useState("");
  const text = draft.trim();
  const busy = decideBusy || replyBusy;

  const pending = item.state === "pending";
  const ours = item.owed_by === "us";
  // A question is settled by answering it — there is no separate approval, so
  // the one send button is the decision while it is open.
  const answering = pending && !ours && item.item_type === "question";
  const decidable = pending && !ours && item.item_type !== "question";

  function send() {
    if (!text) return;
    if (answering) onDecide("approved", text);
    else onReply(text);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3">
        {threadOf(item).map((m) => (
          <li
            key={m.id}
            className={cn(
              "max-w-[85%] rounded-lg px-3.5 py-2.5",
              m.from === "them"
                ? "self-end bg-m-primary-container text-m-on-primary-container"
                : "self-start bg-m-surface-container text-m-on-surface",
            )}
          >
            <p className="text-label-small opacity-75">
              {m.from === "them" ? (m.author ?? youAre ?? "You") : "Converted Click"} · {when(m.at)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-body-medium">{m.body}</p>
          </li>
        ))}
      </ol>

      {/* The outcome closes the thread rather than sitting above it in a
          banner. A conversation reads downward; announcing the ending first
          and then showing the messages that led to it does not. */}
      {item.state !== "pending" ? (
        <p className="text-center text-label-small text-m-on-surface-variant">
          {item.state === "approved"
            ? (SETTLED_LINE[item.item_type]?.done ?? SETTLED_LINE.brief.done)
            : (SETTLED_LINE[item.item_type]?.back ?? SETTLED_LINE.brief.back)}
          {item.decided_by_name ? ` · ${item.decided_by_name}` : ""}
          {settledAt(item) ? `, ${settledAt(item)}` : ""}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Textarea
          rows={3}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            answering
              ? "Your answer…"
              : ours
                ? "Need it sooner? Tell us here."
                : "Write a reply…"
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Approving takes no words, so it is a button on its own and never
              needs the box. Everything else sends what has been typed. */}
          {decidable ? (
            <>
              <Button disabled={busy} onClick={() => onDecide("approved")}>
                {item.item_type === "agreement" ? "I've done this" : "Approve"}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !text}
                title={text ? undefined : "Say what needs to change first"}
                onClick={() => {
                  onDecide("changes_requested", text);
                  setDraft("");
                }}
              >
                {item.item_type === "agreement" ? "Not yet" : "Request changes"}
              </Button>
            </>
          ) : null}

          <Button
            variant={answering ? "default" : "outline"}
            disabled={busy || !text}
            onClick={send}
          >
            <Send className="mr-1.5 h-4 w-4" />
            {answering ? "Send answer" : "Send"}
          </Button>
        </div>

        {error ? <p className="text-label-small text-destructive">{error}</p> : null}
        <p className="text-label-small text-m-on-surface-variant">
          {answering
            ? "Sending your answer closes this off. Anything after that just comes through as a message."
            : decidable
              ? "Approving closes this off. Sending on its own is just a message and decides nothing."
              : "This comes straight to us."}
        </p>
      </div>
    </div>
  );
}
