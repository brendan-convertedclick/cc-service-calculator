// Put a revision back to Draft.
//
// The only control in the systems library that moves a revision BACKWARDS,
// and deliberately the only one open to every role. Publishing is the admin
// act; taking something back to be worked on is the opposite of an approval,
// and the person who notices a procedure is wrong is almost always the person
// running it rather than the person allowed to sign it off.
//
// It always confirms, in all three states. Not because pulling a draft out of
// review is dangerous, but because the same click clears every sign-off
// already recorded against the revision, and that is not visible from the
// button. The rule underneath is the one the Send-for-review dialog already
// follows: carry the people, never the `approved_at`. Nobody is ever shown as
// having signed content they did not read.
//
// The write is `system_revision_back_to_draft` (0147), a SECURITY DEFINER RPC
// rather than a plain update — staff have no UPDATE on a published row and
// must not be given one, or published content could be rewritten in place.

import { useState } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/utils";
import { useBackToDraft } from "@/hooks/useSystemRevisions";

/** The states a revision can come back from. Draft is already there, and
 *  superseded is history — reopening a replaced revision would fork the
 *  procedure into two live versions of the past. */
const REOPENABLE = new Set(["proposed", "changes_requested", "published"]);

function canGoBackToDraft(state: string): boolean {
  return REOPENABLE.has(state);
}

/** What this particular click costs, in the words that fit that state. */
function warning(state: string, label: string): { title: string; body: string; cta: string } {
  if (state === "published") {
    return {
      title: `Un-approve ${label}?`,
      body:
        "This is the team's currently approved version. Taking it back leaves the procedure with nothing approved — it reads as Draft until a revision is approved again, and the version it replaced is not brought back.",
      cta: "Un-approve and edit",
    };
  }
  if (state === "proposed") {
    return {
      title: `Pull ${label} out of review?`,
      body:
        "It stops waiting on its reviewers and becomes editable again. Anyone who has already signed it off will need to sign again once it goes back for review.",
      cta: "Pull it back",
    };
  }
  return {
    title: `Reopen ${label}?`,
    body: "It becomes editable again so the requested changes can be made on this revision.",
    cta: "Reopen it",
  };
}

export function BackToDraftButton({
  systemId,
  revisionId,
  state,
  revisionLabel,
  size = "sm",
}: {
  systemId: string;
  revisionId: string;
  state: string;
  /** "Rev 3" — what the dialog calls the thing being pulled back. */
  revisionLabel: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const backToDraft = useBackToDraft();

  if (!canGoBackToDraft(state)) return null;
  const copy = warning(state, revisionLabel);

  return (
    <>
      <Button
        size={size}
        variant="outline"
        disabled={backToDraft.isPending}
        onClick={() => setOpen(true)}
      >
        <Undo2 className="mr-1.5 h-3.5 w-3.5" />
        Back to draft
      </Button>

      <Dialog open={open} onOpenChange={(o) => !backToDraft.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.body}</DialogDescription>
          </DialogHeader>
          {/* Said out loud on every path, because it is the part the button
              cannot show: the sign-off dates go, the names stay. */}
          <p className="text-body-small text-m-on-surface-variant">
            Sign-offs already recorded are cleared — the people stay named, the dates do not, so
            nobody is shown as having agreed to something they have not read.
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={backToDraft.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={backToDraft.isPending}
              onClick={() =>
                backToDraft.mutate(
                  { revisionId, systemId },
                  {
                    onSuccess: () => {
                      toast.success(`${revisionLabel} is back to draft`);
                      setOpen(false);
                    },
                    onError: (e) => toast.error(`Could not reopen: ${errorMessage(e)}`),
                  },
                )
              }
            >
              {backToDraft.isPending ? "Working…" : copy.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
