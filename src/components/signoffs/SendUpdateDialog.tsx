// src/components/signoffs/SendUpdateDialog.tsx
//
// The quick chase: a covering line, the people it goes to, send. Everything
// factual in the email — how many things are waiting, with us, signed off, and
// how long the oldest has been sitting — is rendered by the template from the
// same counts the client's own page uses, so there is nothing to type but the
// human part.
//
// The default wording is there so this takes one click on a normal Monday. It
// deliberately quotes no numbers: see buildChaseEmail.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSendClientChase } from "@/hooks/useClientChase";
import { useClientContacts } from "@/hooks/useContacts";
import { errorMessage, toggleInSet } from "@/lib/utils";

const DEFAULT_MESSAGE =
  "Just a quick note on where things stand. Everything currently sitting with you is on your sign-off page, and the button below takes you straight there. No login needed. Shout if anything on it needs a conversation rather than a click.";

export function SendUpdateDialog({
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
  const chase = useSendClientChase();

  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Fresh template each time, and everyone ticked — a chase normally goes to
  // the whole side of the table, unlike a question, which goes to the one
  // person who can answer it.
  useEffect(() => {
    if (!open) return;
    setMessage(DEFAULT_MESSAGE);
    setPicked(new Set(contacts.map((c) => c.id)));
  }, [open, contacts]);

  const recipients = contacts
    .filter((c) => picked.has(c.id))
    .map((c) => ({ id: c.id, email: c.email, name: c.full_name }));
  const canSend = !!message.trim() && recipients.length > 0;

  async function send() {
    try {
      const { failures } = await chase.mutateAsync({ clientId, message, recipients });
      const sent = recipients.length - failures.length;
      if (failures.length > 0) {
        toast.warning(
          `Sent to ${sent} of ${recipients.length}. Did not reach: ${failures.join("; ")}`,
        );
      } else {
        toast.success(`Update sent to ${sent === 1 ? recipients[0].email : `${sent} people`}.`);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Send {clientName} an update</DialogTitle>
          <DialogDescription>
            One email per person, each on their own link. It carries a count of what is waiting
            on them, what is with us and what is signed off. Those figures come straight off
            their page, so it cannot say anything their page does not.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chase-body">The note</Label>
            <Textarea
              id="chase-body"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-label-small text-m-on-surface-variant">
              Leave the numbers out. The email counts the outstanding items itself, and two
              counts in one letter is one too many.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Send to</Label>
            {contactsPending ? (
              <p className="text-body-small text-m-on-surface-variant">Loading contacts…</p>
            ) : contacts.length === 0 ? (
              <p className="text-body-small text-m-on-surface-variant">
                {clientName} has no contacts yet, and we need an address to send to.{" "}
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={chase.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={!canSend || chase.isPending}>
            {chase.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-4 w-4" />
            )}
            Send update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
