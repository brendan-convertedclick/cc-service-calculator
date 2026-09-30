// src/components/moments/MomentDetailDialog.tsx
//
// One date, opened from the calendar or the Ask-about-soon list: who, what to
// say, who already said it, and the edit / delete / mark-asked controls.
// Delete confirms inline — the product never uses a browser confirm().

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useTeam } from "@/hooks/useTeam";
import { useDeleteMoment, useSetMomentAsked } from "@/hooks/useContactMoments";
import { askKey, askLine, KIND_META, occurrenceTitle, type MomentAsk, type Occurrence } from "@/lib/contact-moments";
import { errorMessage } from "@/lib/utils";

function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function MomentDetailDialog({
  occurrence,
  asked,
  onClose,
  onEdit,
}: {
  occurrence: Occurrence | null;
  asked: Map<string, MomentAsk>;
  onClose: () => void;
  onEdit: (o: Occurrence) => void;
}) {
  const { currentUserId } = useAuth();
  const { data: team = [] } = useTeam();
  const setAsked = useSetMomentAsked();
  const del = useDeleteMoment();
  const [confirming, setConfirming] = useState(false);

  const o = occurrence;
  const ask = o ? asked.get(askKey(o.moment.id, o.date, "before")) : undefined;
  const who = ask?.asked_by ? team.find((t) => t.id === ask.asked_by)?.full_name ?? "Someone" : "Someone";

  async function toggleAsked() {
    if (!o) return;
    try {
      await setAsked.mutateAsync({ momentId: o.moment.id, date: o.date, stage: "before", asked: !ask, by: currentUserId });
      toast.success(ask ? "Unmarked" : "Marked as asked");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove() {
    if (!o) return;
    try {
      await del.mutateAsync(o.moment.id);
      toast.success("Deleted");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog
      open={!!o}
      onOpenChange={(v) => {
        if (!v) {
          setConfirming(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        {o ? (
          <>
            <DialogHeader>
              <DialogTitle>{occurrenceTitle(o)}</DialogTitle>
              <DialogDescription>
                {longDate(o.date)}
                {o.moment.repeats_yearly ? " · every year" : ""}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-body-medium">
              <dt className="text-m-on-surface-variant">Person</dt>
              <dd>
                {o.moment.contactName}
                {o.moment.contactRole ? <span className="text-m-on-surface-variant"> · {o.moment.contactRole}</span> : null}
              </dd>
              <dt className="text-m-on-surface-variant">School</dt>
              <dd>{o.moment.clientName}</dd>
              <dt className="text-m-on-surface-variant">Type</dt>
              <dd>{KIND_META[o.moment.kind].label}</dd>
              <dt className="text-m-on-surface-variant">Ask</dt>
              <dd>{askLine(o, "before")}</dd>
              {ask ? (
                <>
                  <dt className="text-m-on-surface-variant">Asked</dt>
                  <dd>
                    {who},{" "}
                    {new Date(ask.asked_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                  </dd>
                </>
              ) : null}
            </dl>

            {o.moment.notes ? (
              <p className="whitespace-pre-wrap rounded-md bg-m-surface-container p-3 text-body-medium [overflow-wrap:anywhere]">
                {o.moment.notes}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="mr-auto flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onEdit(o)}>
                  Edit
                </Button>
                {confirming ? (
                  <>
                    <span className="text-body-small text-m-error">Delete this date?</span>
                    <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={del.isPending}>
                      Delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" className="text-m-error" onClick={() => setConfirming(true)}>
                    Delete
                  </Button>
                )}
              </div>
              <Button variant={ask ? "outline" : "default"} onClick={() => void toggleAsked()} disabled={setAsked.isPending}>
                {ask ? "Undo asked" : "Mark as asked"}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
