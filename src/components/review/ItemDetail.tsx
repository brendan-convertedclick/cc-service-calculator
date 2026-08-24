import { Badge } from "@/components/ui/badge";
import { DecisionControls } from "@/components/review/DecisionControls";
import type { ReviewDecision, ReviewItem } from "@/types/client-review";

export interface ItemDetailProps {
  item: ReviewItem;
  /** Shown under the company name as "Deciding as …". null before the first decision. */
  approverName: string | null;
  busy: boolean;
  /** Inline failure text under the buttons, already humanised by the page. */
  error: string | null;
  overdue: boolean;
  /** comment is present only for "changes_requested". */
  onDecide: (decision: ReviewDecision, comment?: string) => void;
}

/** "YYYY-MM-DD" -> "24 Aug". Built from the date parts, not `new Date(str)`,
 * so it can't drift a day under a UTC parse (see @/lib/dates). */
function formatDueDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

/** ISO timestamp -> "24 Aug at 14:35", for the confirmation line only. */
function formatDecidedAt(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} at ${time}`;
}

/**
 * Same markup for both the desktop column and the mobile Sheet — the page
 * decides where to mount it. Once the item leaves "pending" the decision
 * buttons are replaced by the confirmation line; everything above stays put
 * so a client can still see what they agreed to.
 */
export function ItemDetail({ item, approverName, busy, error, overdue, onDecide }: ItemDetailProps) {
  return (
    <div className="flex flex-col gap-6">
      {approverName ? (
        <p className="text-label-small text-m-on-surface-variant">Deciding as {approverName}</p>
      ) : null}

      <div>
        {overdue || item.weighty ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {overdue ? (
              <Badge className="border-transparent bg-m-error-container text-m-on-error-container">
                Overdue
              </Badge>
            ) : null}
            {item.weighty ? <Badge variant="outline">Needs a formal sign-off</Badge> : null}
          </div>
        ) : null}
        <h1 className="text-headline-small text-m-on-surface">{item.client_title}</h1>
        {item.due_date ? (
          <p className="mt-1 text-label-small text-m-on-surface-variant">
            {overdue ? "Was needed by " : "Needed by "}
            {formatDueDate(item.due_date)}
          </p>
        ) : null}
      </div>

      <div>
        <h2 className="text-title-small text-m-on-surface">What we need from you</h2>
        <p className="mt-1 whitespace-pre-wrap text-body-medium text-m-on-surface-variant">{item.ask}</p>
      </div>

      {item.detail ? (
        <div>
          <h2 className="text-title-small text-m-on-surface">The detail</h2>
          <p className="mt-1 whitespace-pre-wrap text-body-medium text-m-on-surface-variant">
            {item.detail}
          </p>
        </div>
      ) : null}

      {item.state === "pending" ? (
        <DecisionControls key={item.id} busy={busy} error={error} onDecide={onDecide} />
      ) : (
        <div className="rounded-lg bg-m-surface-container p-4">
          <p className="text-body-medium text-m-on-surface">
            {item.state === "approved"
              ? "Approved — thank you. We're getting on with it."
              : "Thanks — your notes are with us. We'll come back to you."}
          </p>
          {item.decided_at ? (
            <p className="mt-1 text-label-small text-m-on-surface-variant">
              {item.state === "approved" ? "Approved by " : "Changes requested by "}
              {item.decided_by_name} on {formatDecidedAt(item.decided_at)}.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
