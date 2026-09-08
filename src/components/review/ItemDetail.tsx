// src/components/review/ItemDetail.tsx
//
// The item, and the two buttons that settle it. What has happened to it is the
// column beside this one (ItemActivity) — what a thing IS and what has been
// said and done about it are different reads, and stacking them made the ask
// scroll off the top of the screen while the client typed.
//
// The decision lives here, next to the thing being decided, and nowhere else.
// "Request changes" needs words, and the words are typed under Activity: the
// page owns that draft and hands it to both columns, so there is still exactly
// one box on the screen and no chance of typing into the wrong one.

import { CheckCircle2, CornerUpLeft, ExternalLink, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { docLinkLabel } from "@/lib/doc-links";
import { agreedLine, typeLabelFor } from "@/lib/client-review";
import { DueBadge } from "@/components/review/DueBadge";
import { HeldBadge } from "@/components/review/HeldBadge";
import type { ReviewDecision, ReviewItem } from "@/types/client-review";

export interface ItemDetailProps {
  item: ReviewItem;
  /** Shown under the company name as "Deciding as …". null before the first decision. */
  approverName: string | null;
  busy: boolean;
  /** Inline failure text under the buttons, already humanised by the page. */
  error: string | null;
  overdue: boolean;
  /** What is currently typed under Activity — "Request changes" sends it. */
  draft: string;
  /** comment is present only for "changes_requested". */
  onDecide: (decision: ReviewDecision, comment?: string) => void;
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
 * buttons are gone; everything above stays put so a client can still see what
 * they agreed to.
 */
export function ItemDetail({
  item,
  approverName,
  busy,
  error,
  overdue,
  draft,
  onDecide,
}: ItemDetailProps) {
  // A question has no separate approval — sending the answer settles it, and
  // that button is in the chat. Anything we owe them is not theirs to press.
  const decidable =
    item.state === "pending" && item.owed_by !== "us" && item.item_type !== "question";
  const text = draft.trim();

  return (
    <div className="flex flex-col gap-6">
      {approverName ? (
        <p className="text-label-small text-m-on-surface-variant">Deciding as {approverName}</p>
      ) : null}

      <div>
        <div className="mb-2 flex flex-wrap gap-1">
          <Badge variant="outline">{typeLabelFor(item)}</Badge>
          <DueBadge item={item} />
          <HeldBadge item={item} />
          {item.weighty ? <Badge variant="outline">Needs a formal sign-off</Badge> : null}
        </div>
        <h1 className="text-headline-small text-m-on-surface">{item.client_title}</h1>
        {agreedLine(item) ? (
          <p className="mt-1 text-label-small text-m-on-surface-variant">{agreedLine(item)}</p>
        ) : null}
        {item.due_date ? (
          <p className="mt-1 text-label-small text-m-on-surface-variant">
            {/* An event's date is when it happens, not when it is owed. */}
            {item.state === "noted" ? "Happening on " : overdue ? "Was needed by " : "Needed by "}
            {formatDueDate(item.due_date)}
          </p>
        ) : null}
      </div>

      {item.links.length > 0 ? (
        <div>
          <h2 className="text-title-small text-m-on-surface">What it&apos;s about</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {item.links.map((link) => (
              <li key={link}>
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  title={link}
                  className="inline-flex items-center gap-1 rounded-md bg-m-secondary-container px-2 py-1 text-label-small text-m-on-secondary-container hover:underline"
                >
                  {docLinkLabel(link)}
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
            should know under Activity.
          </p>
        </div>
      ) : null}

      {decidable ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {/* Sending it back on the left, closing it off on the right —
                the affirmative one last, where a reader's eye ends up.
                Approving takes no words; requesting changes takes the ones
                under Activity, so it stays disabled until there are some. */}
            <Button
              variant="outline"
              disabled={busy || !text}
              title={text ? undefined : "Say what needs to change under Activity first"}
              onClick={() => onDecide("changes_requested", text)}
            >
              <CornerUpLeft className="mr-1.5 h-4 w-4" />
              {item.item_type === "agreement" ? "Not yet" : "Request changes"}
            </Button>
            <Button disabled={busy} onClick={() => onDecide("approved")}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              {item.item_type === "agreement" ? "I've done this" : "Approve"}
            </Button>
          </div>
          {error ? <p className="text-label-small text-destructive">{error}</p> : null}
          {/* An aside, and it should look like one: the icon marks it as
              guidance rather than something that happened, and it sits back
              from the buttons it explains. */}
          <p className="flex items-start gap-1.5 text-label-small text-m-on-surface-variant opacity-80">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Approving closes this off. Request changes sends what you&apos;ve written under
              Activity.
            </span>
          </p>
        </div>
      ) : error ? (
        <p className="text-label-small text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
