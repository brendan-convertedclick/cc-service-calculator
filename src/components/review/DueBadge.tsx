import { Badge } from "@/components/ui/badge";
import { dueStatus, eventDateLabel } from "@/lib/client-review";
import type { ReviewItem } from "@/types/client-review";

/**
 * The one place the due date becomes a badge. The queue row and the detail
 * pane both show it, and two copies of this would drift the day one of them
 * gained a state the other didn't — which is how the queue ended up saying
 * "Overdue" with no number while being sorted by exactly that number.
 *
 * Renders nothing when there is no deadline to report. An empty due date is
 * not a deadline of zero.
 */
export function DueBadge({ item }: { item: ReviewItem }) {
  // An event's date is a fact, not a deadline — no colour, no countdown, and
  // it is the only thing on the row worth reading, so it is never dropped.
  const eventDate = eventDateLabel(item);
  if (eventDate) return <Badge variant="muted">{eventDate}</Badge>;

  const status = dueStatus(item);
  if (!status) return null;

  if (status.kind === "overdue") {
    return (
      <Badge className="border-transparent bg-m-error-container text-m-on-error-container">
        Overdue · {status.days}d
      </Badge>
    );
  }
  if (status.kind === "waiting") {
    // Same "your move" colour as Due today: no date was ever set, so this is
    // not a missed deadline, but it is squarely their turn.
    return (
      <Badge className="border-transparent bg-m-primary-container text-m-on-primary-container">
        Waiting · {status.days}d
      </Badge>
    );
  }
  if (status.kind === "today") {
    return (
      <Badge className="border-transparent bg-m-primary-container text-m-on-primary-container">
        Due today
      </Badge>
    );
  }
  return <Badge variant="muted">Due in {status.days}d</Badge>;
}
