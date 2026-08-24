// src/components/briefs/ClientSignoffDialog.tsx
//
// "Send for client sign-off" — creates one client_approvals row. Exactly two
// fields: a client-facing title and the one-line ask. The title is typed by
// a human here, never derived from raw_subject (real subjects carry "DFT
// V1.1", "(QC)", "REV V2.3" — unusable in front of a client). Token issuance
// and the /review page are other agents' work; this dialog only writes the
// row that puts an item in front of a client.

import { useState } from "react";
import { toast } from "sonner";
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
import { useSendForClientSignoff } from "@/hooks/useClientApprovals";
import { errorMessage } from "@/lib/utils";

interface ClientSignoffDialogProps {
  briefId: string;
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClientSignoffDialog({ briefId, clientId, open, onOpenChange }: ClientSignoffDialogProps) {
  const [title, setTitle] = useState("");
  const [ask, setAsk] = useState("");
  const send = useSendForClientSignoff();

  const handleOpenChange = (o: boolean) => {
    if (o) {
      setTitle("");
      setAsk("");
    }
    onOpenChange(o);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !ask.trim()) return;
    try {
      await send.mutateAsync({ briefId, clientId, clientTitle: title, ask });
      toast.success("Sent for client sign-off");
      onOpenChange(false);
    } catch (e) {
      toast.error(`Couldn't send for sign-off: ${errorMessage(e)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send for client sign-off</DialogTitle>
          <DialogDescription>
            The client sees only these two fields, and nothing else about this brief — never a raw
            email subject, never anyone's name at Converted Click.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="signoff-title">Client-facing title</Label>
            <Input
              id="signoff-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Homepage redesign — final draft"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signoff-ask">What we need from them</Label>
            <Textarea
              id="signoff-ask"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              rows={3}
              placeholder="One line: what should they approve or review?"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={send.isPending || !title.trim() || !ask.trim()}>
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
