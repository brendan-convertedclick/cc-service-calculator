// src/components/signoffs/LogAgreementDialog.tsx
//
// "You said in the meeting on the 4th that you'd send us the logos by Friday."
//
// That sentence only carries weight if it was written down at the time, so
// this exists to take fifteen seconds straight after the call. Three fields
// are mandatory and none of them are the ones you'd guess: what, when they
// agreed, and HOW they agreed. The due date is optional — plenty of
// commitments are made without one, and a made-up date is worse than none.
//
// Nothing is emailed. An agreement is a record; the client sees it on their
// page alongside everything else waiting on them.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Handshake, Loader2 } from "lucide-react";
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
import { useLogClientAgreement, type AgreementInput } from "@/hooks/useClientAsks";
import { todayISO } from "@/lib/dates";
import { cn, errorMessage } from "@/lib/utils";

const VIA: { id: AgreementInput["agreedVia"]; label: string }[] = [
  { id: "meeting", label: "In a meeting" },
  { id: "call", label: "On a call" },
  { id: "email", label: "By email" },
  { id: "message", label: "In a message" },
  { id: "other", label: "Somewhere else" },
];

export function LogAgreementDialog({
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
  const log = useLogClientAgreement();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [agreedAt, setAgreedAt] = useState(todayISO());
  const [agreedVia, setAgreedVia] = useState<AgreementInput["agreedVia"]>("meeting");
  const [owedBy, setOwedBy] = useState<AgreementInput["owedBy"]>("client");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDetail("");
    setDueDate("");
    // Today, but editable: these are usually written up after the meeting,
    // and the date that matters is the meeting's, not the typing's.
    setAgreedAt(todayISO());
    setAgreedVia("meeting");
    setOwedBy("client");
  }, [open]);

  async function save() {
    try {
      await log.mutateAsync({
        clientId,
        owedBy,
        title,
        detail,
        dueDate: dueDate || null,
        agreedAt,
        agreedVia,
      });
      toast.success("Agreement recorded.");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Record an agreement with {clientName}</DialogTitle>
          <DialogDescription>
            Something one side committed to, with the date and the place it was agreed. Theirs
            shows on their page as theirs to close; ours shows there as with us, and can be
            turned into a task.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Who owes this?</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "client" as const, label: `${clientName} owes us` },
                  { id: "us" as const, label: "We owe them" },
                ]
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOwedBy(o.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-label-large transition-colors",
                    owedBy === o.id
                      ? "border-transparent bg-m-primary-container text-m-on-primary-container"
                      : "border-m-outline-variant text-m-on-surface-variant hover:bg-m-surface-container",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-title">{owedBy === "us" ? "We agreed to…" : "They agreed to…"}</Label>
            <Input
              id="a-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={owedBy === "us" ? "Send the revised mailer copy" : "Send us the accreditation logos"}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-detail">Any detail (optional)</Label>
            <Textarea
              id="a-detail"
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Vector files for Umalusi, ISASA and Safe Harbor — Chantal said marketing has them."
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-agreed">Agreed on</Label>
              <Input
                id="a-agreed"
                type="date"
                className="w-44"
                value={agreedAt}
                max={todayISO()}
                onChange={(e) => setAgreedAt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-due">By when (optional)</Label>
              <Input
                id="a-due"
                type="date"
                className="w-44"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>How it was agreed</Label>
            <div className="flex flex-wrap gap-1.5">
              {VIA.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setAgreedVia(v.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-label-large transition-colors",
                    agreedVia === v.id
                      ? "border-transparent bg-m-primary-container text-m-on-primary-container"
                      : "border-m-outline-variant text-m-on-surface-variant hover:bg-m-surface-container",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={log.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!title.trim() || !agreedAt || log.isPending}>
            {log.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Handshake className="mr-1.5 h-4 w-4" />
            )}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
