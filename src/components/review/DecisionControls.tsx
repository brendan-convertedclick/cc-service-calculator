import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewDecision } from "@/types/client-review";

export interface DecisionControlsProps {
  busy: boolean;
  error: string | null;
  /** Owns the textarea's local state; clears it after a successful send. */
  onDecide: (decision: ReviewDecision, comment?: string) => void;
}

/**
 * Treatment A, step one: Approve / Request changes. Request changes reveals
 * a textarea + Send in place of the two buttons — the page only learns about
 * a "changes_requested" decision once Send fires with a non-empty comment.
 * On a genuine approve/success the parent swaps this whole component out for
 * the confirmation line (see ItemDetail), so there is no local "clear on
 * success" to wire up here — only a failed Send needs the note to survive so
 * the client isn't made to retype it.
 */
export function DecisionControls({ busy, error, onDecide }: DecisionControlsProps) {
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [comment, setComment] = useState("");

  const send = () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    onDecide("changes_requested", trimmed);
  };

  return (
    <div className="flex flex-col gap-3">
      {requestingChanges ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            placeholder="What needs to change?"
            value={comment}
            disabled={busy}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button onClick={send} disabled={busy || !comment.trim()} className="sm:self-start">
            Send
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => onDecide("approved")}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => setRequestingChanges(true)}
          >
            Request changes
          </Button>
        </div>
      )}
      {error ? <p className="text-label-small text-destructive">{error}</p> : null}
    </div>
  );
}
