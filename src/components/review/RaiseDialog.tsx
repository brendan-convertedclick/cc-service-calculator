// src/components/review/RaiseDialog.tsx
//
// The client's side of the list, going the other way.
//
// Until now everything here was ours: they could answer, approve and reply,
// but the two things they most often want to start themselves — a question,
// and a date we ought to know about — had to go to email, where the list
// cannot see them and nobody is counted as waiting.
//
// ONE DIALOG, TWO MODES, AND THE MODE IS THE FIRST THING ON IT. What pressing
// send does is carried by the choice at the top, never inferred from which
// fields happen to be filled: a question comes to us to answer, a date goes on
// the calendar and asks nothing of anyone. They are different enough that a
// single ambiguous "add something" box would produce a pile of neither.

import { useEffect, useState } from "react";
import { CalendarPlus, Loader2, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { RaiseKind } from "@/types/client-review";

const COPY: Record<RaiseKind, { title: string; blurb: string; cta: string }> = {
  question: {
    title: "Ask us something",
    blurb:
      "It comes straight to us and lands on your list, so you can see we have it and when we come back to you.",
    cta: "Send question",
  },
  event: {
    title: "Add a date",
    blurb:
      "Something happening on your side that we should plan around — a launch, a sale, an event, time out of office. Nobody has to action it; it just goes on the calendar.",
    cta: "Add it",
  },
};

export function RaiseDialog({
  open,
  onOpenChange,
  initialKind,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind: RaiseKind;
  busy: boolean;
  /** Rendered under the buttons — a validation reason, or the preview notice. */
  error: string | null;
  onSubmit: (input: { kind: RaiseKind; title: string; body?: string; date?: string }) => void;
}) {
  const [kind, setKind] = useState<RaiseKind>(initialKind);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setTitle("");
    setBody("");
    setDate("");
  }, [open, initialKind]);

  const copy = COPY[kind];
  const ready = kind === "event" ? !!title.trim() && !!date : !!title.trim() && !!body.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.blurb}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {(["question", "event"] as RaiseKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-label-large transition-colors",
                  kind === k
                    ? "border-transparent bg-m-primary-container text-m-on-primary-container"
                    : "border-m-outline-variant text-m-on-surface-variant hover:bg-m-surface-container",
                )}
              >
                {k === "question" ? "A question for you" : "A date on our side"}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="raise-title">
              {kind === "event" ? "What's happening?" : "What's it about?"}
            </Label>
            <Input
              id="raise-title"
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={
                kind === "event" ? "Spring sale goes live" : "The October mailer"
              }
            />
          </div>

          {kind === "event" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="raise-date">When</Label>
              <Input
                id="raise-date"
                type="date"
                className="w-44"
                value={date}
                disabled={busy}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="raise-body">
              {kind === "event" ? "Anything we should know (optional)" : "Your question"}
            </Label>
            <Textarea
              id="raise-body"
              rows={kind === "event" ? 2 : 4}
              value={body}
              disabled={busy}
              maxLength={4000}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                kind === "event"
                  ? "Stand artwork needs to be with the printer two weeks before."
                  : "Are we still on for the October send, and what do you need from us?"
              }
            />
          </div>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {error ? (
            <p className="mr-auto text-label-small text-destructive">{error}</p>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={() =>
              onSubmit({
                kind,
                title: title.trim(),
                body: body.trim() || undefined,
                date: kind === "event" ? date : undefined,
              })
            }
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : kind === "event" ? (
              <CalendarPlus className="mr-1.5 h-4 w-4" />
            ) : (
              <MessageCircleQuestion className="mr-1.5 h-4 w-4" />
            )}
            {copy.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
