import { Badge } from "@/components/ui/badge";
import { ItemConversation } from "@/components/review/ItemConversation";
import { agreedLine, typeLabelFor } from "@/lib/client-review";
import { DueBadge } from "@/components/review/DueBadge";
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
  /** Sending a message. Separate from onDecide — a reply decides nothing. */
  onReply: (body: string) => void;
  replyBusy: boolean;
  replyError: string | null;
}

/** "YYYY-MM-DD" -> "24 Aug". Built from the date parts, not `new Date(str)`,
 * so it can't drift a day under a UTC parse (see @/lib/dates). */
function formatDueDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

/**
 * Same markup for both the desktop column and the mobile Sheet — the page
 * decides where to mount it. Once the item leaves "pending" the decision
 * buttons are replaced by the confirmation line; everything above stays put
 * so a client can still see what they agreed to.
 */
export function ItemDetail({
  item,
  approverName,
  busy,
  error,
  overdue,
  onDecide,
  onReply,
  replyBusy,
  replyError,
}: ItemDetailProps) {
  return (
    <div className="flex flex-col gap-6">
      {approverName ? (
        <p className="text-label-small text-m-on-surface-variant">Deciding as {approverName}</p>
      ) : null}

      <div>
        <div className="mb-2 flex flex-wrap gap-1">
          <Badge variant="outline">{typeLabelFor(item)}</Badge>
          <DueBadge item={item} />
          {item.weighty ? <Badge variant="outline">Needs a formal sign-off</Badge> : null}
        </div>
        <h1 className="text-headline-small text-m-on-surface">{item.client_title}</h1>
        {agreedLine(item) ? (
          <p className="mt-1 text-label-small text-m-on-surface-variant">{agreedLine(item)}</p>
        ) : null}
        {item.due_date ? (
          <p className="mt-1 text-label-small text-m-on-surface-variant">
            {/* An event's date is when it happens, not when it is owed. */}
            {item.state === "noted"
              ? "Happening on "
              : overdue
                ? "Was needed by "
                : "Needed by "}
            {formatDueDate(item.due_date)}
          </p>
        ) : null}
      </div>

      {item.detail ? (
        <div>
          <h2 className="text-title-small text-m-on-surface">The detail</h2>
          <p className="mt-1 whitespace-pre-wrap text-body-medium text-m-on-surface-variant">
            {item.detail}
          </p>
        </div>
      ) : null}

      {item.state === "pending" && item.owed_by === "us" ? (
        <div className="rounded-lg bg-m-surface-container p-4">
          <p className="text-body-medium text-m-on-surface">
            {item.raised_by === "client"
              ? "You asked us this — it's with us. We'll answer right here."
              : "This one is with us — we said we would do it. Nothing for you to press."}
          </p>
        </div>
      ) : null}

      {item.state === "noted" ? (
        <div className="rounded-lg bg-m-surface-container p-4">
          <p className="text-body-medium text-m-on-surface">
            A date on your side, so we can plan around it. Nothing to approve — add anything we
            should know below.
          </p>
        </div>
      ) : null}

      {/* One thread and one box, whatever state it is in — "actually, one more
          thing" arrives after an approval as often as before one. */}
      <ItemConversation
        key={item.id}
        item={item}
        youAre={approverName}
        decideBusy={busy}
        replyBusy={replyBusy}
        error={error ?? replyError}
        onDecide={onDecide}
        onReply={onReply}
      />
    </div>
  );
}
