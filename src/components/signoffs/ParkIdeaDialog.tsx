// src/components/signoffs/ParkIdeaDialog.tsx
//
// "We should probably look at their Google Business listing at some point."
//
// The third thing that comes out of a client meeting, after the asks and the
// commitments. It is not waiting on anybody and it has no date, so it fitted
// nowhere on this page and lived in somebody's head instead.
//
// Two fields, one of them optional, because the whole value is that writing it
// down costs less than remembering it. Nothing is emailed and the client never
// sees it — see useParkIdea and 0148.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lightbulb, Loader2 } from "lucide-react";
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
import { useParkIdea, type IdeaInput } from "@/hooks/useClientAsks";
import { cn, errorMessage } from "@/lib/utils";

export function ParkIdeaDialog({
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
  const park = useParkIdea();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [reviewOn, setReviewOn] = useState("");
  const [owedBy, setOwedBy] = useState<IdeaInput["owedBy"]>("us");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDetail("");
    setReviewOn("");
    setOwedBy("us");
  }, [open]);

  async function save() {
    try {
      await park.mutateAsync({
        clientId,
        owedBy,
        title,
        detail,
        reviewOn: reviewOn || null,
      });
      toast.success("Parked. It's on the list, not on anyone's clock.");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Park an idea for {clientName}</DialogTitle>
          <DialogDescription>
            Worth considering, not planned yet. It sits on the Parked list with no due date and
            no chasing, and {clientName} never sees it — raise it as a question or an agreement
            when the time is right.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-title">The idea</Label>
            <Input
              id="i-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Redo the Google Business listing photos"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-detail">Why it is worth doing (optional)</Label>
            <Textarea
              id="i-detail"
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Every photo is from the old premises. Came up on the August call — not a priority until the refit is finished."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Whose move will it be?</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "us" as const, label: "Ours to raise" },
                  { id: "client" as const, label: `${clientName}'s call` },
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
            <Label htmlFor="i-review">Look at it again on (optional)</Label>
            <Input
              id="i-review"
              type="date"
              className="w-44"
              value={reviewOn}
              onChange={(e) => setReviewOn(e.target.value)}
            />
            <p className="text-body-small text-m-on-surface-variant">
              A reminder to yourself, not a deadline — nothing goes late.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={park.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!title.trim() || park.isPending}>
            {park.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Lightbulb className="mr-1.5 h-4 w-4" />
            )}
            Park it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
