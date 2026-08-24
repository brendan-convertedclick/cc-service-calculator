import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { RememberedApprover, ReviewContact } from "@/types/client-review";

export interface IdentityDialogProps {
  open: boolean;
  contacts: ReviewContact[];
  /** The page then fires the pending decision immediately. */
  onPick: (approver: RememberedApprover) => void;
  /** Dismiss — the page clears the pending decision and sends nothing. */
  onCancel: () => void;
}

/**
 * "And you are?" — identity captured at the decision, never at the door.
 * Contacts are one tap each (no Select/Combobox); "Someone else" reveals a
 * two-field form. Both paths call onPick exactly once with a RememberedApprover.
 */
export function IdentityDialog({ open, contacts, onPick, onCancel }: IdentityDialogProps) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const reset = () => {
    setOtherOpen(false);
    setName("");
    setEmail("");
  };

  const submitOther = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedEmail = email.trim();
    onPick({ contact_id: null, name: trimmedName, email: trimmedEmail || null });
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onCancel();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>And you are?</DialogTitle>
          <DialogDescription>We&apos;ll record your name against this decision.</DialogDescription>
        </DialogHeader>

        {otherOpen ? (
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              type="email"
              placeholder="Your email (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button onClick={submitOther} disabled={!name.trim()}>
              Continue
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {contacts.map((contact) => (
              <Button
                key={contact.id}
                variant="ghost"
                className="w-full justify-start"
                onClick={() => onPick({ contact_id: contact.id, name: contact.full_name, email: null })}
              >
                {contact.full_name}
              </Button>
            ))}
            <Button variant="ghost" className="w-full justify-start" onClick={() => setOtherOpen(true)}>
              Someone else
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
