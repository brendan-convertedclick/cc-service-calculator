// src/components/signoffs/AskQuestionDialog.tsx
//
// Type a question, pick who it goes to, send. That is the whole surface, and
// it is deliberately not a compose screen: the body is a fixed template, so
// there is nothing to write except the question itself. A question that takes
// two minutes to send is a question that gets asked tomorrow.
//
// The send has one hard prerequisite — a personal login. See useClientAsks.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAskClientQuestion } from "@/hooks/useClientAsks";
import { useClientContacts } from "@/hooks/useContacts";
import { errorMessage, toggleInSet } from "@/lib/utils";

export function AskQuestionDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
}) {
  const { data: contacts = [], isPending: contactsPending } = useClientContacts(
    open ? clientId : undefined,
  );
  const ask = useAskClientQuestion();

  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Start clean each time it opens, and pre-tick the primary contact — one
  // recipient is the overwhelmingly common case and it is the one field
  // someone forgets.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setQuestion("");
    setDueDate("");
    setPicked(new Set(contacts[0] ? [contacts[0].id] : []));
  }, [open, contacts]);

  const recipients = contacts
    .filter((c) => picked.has(c.id))
    .map((c) => ({ id: c.id, email: c.email, name: c.full_name }));
  const canSend = !!title.trim() && !!question.trim() && recipients.length > 0;

  async function send() {
    try {
      const { failures } = await ask.mutateAsync({
        clientId,
        title: title.trim(),
        question: question.trim(),
        dueDate: dueDate || null,
        recipients,
      });
      const sent = recipients.length - failures.length;
      if (failures.length > 0) {
        toast.warning(
          `Sent to ${sent} of ${recipients.length}. Did not reach: ${failures.join("; ")}`,
        );
      } else {
        toast.success(
          `Question sent to ${sent === 1 ? recipients[0].email : `${sent} people`}.`,
        );
      }
      onOpenChange(false);
    } catch (e) {
      // The row usually exists by now — say so, or someone sends it twice.
      toast.error(
        `${errorMessage(e)} The question is saved and on ${clientName}'s page, but the email did not go out.`,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ask {clientName} a question</DialogTitle>
          <DialogDescription>
            Each person gets their own email and their own link, so the answer comes back
            signed with the name of whoever actually gave it — no login, and nobody has to
            say who they are.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="q-title">What it&apos;s about</Label>
            <Input
              id="q-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Open Day mailer copy"
            />
            <p className="text-label-small text-m-on-surface-variant">
              They read this as the subject line — write it the way they&apos;d recognise it, not
              the way ClickUp names it.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="q-body">The question</Label>
            <Textarea
              id="q-body"
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Which of the two headlines do you want us to run with?"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="q-due">Needed by (optional)</Label>
            <Input
              id="q-due"
              type="date"
              className="w-44"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Send to</Label>
            {contactsPending ? (
              <p className="text-body-small text-m-on-surface-variant">Loading contacts…</p>
            ) : contacts.length === 0 ? (
              <p className="text-body-small text-m-on-surface-variant">
                {clientName} has no contacts yet — we need an address to send to.{" "}
                <Link
                  to={`/clients/${clientId}`}
                  className="text-m-primary underline"
                  onClick={() => onOpenChange(false)}
                >
                  Add one on their client page
                </Link>
                , then come back.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 rounded-lg border border-m-outline-variant p-3">
                {contacts.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-body-medium">
                    <Checkbox
                      checked={picked.has(c.id)}
                      onCheckedChange={() => setPicked((prev) => toggleInSet(prev, c.id))}
                    />
                    <span className="text-m-on-surface">{c.full_name ?? c.email}</span>
                    {c.full_name ? (
                      <span className="text-label-small text-m-on-surface-variant">{c.email}</span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={ask.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={!canSend || ask.isPending}>
            {ask.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-1.5 h-4 w-4" />
            )}
            Send question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
