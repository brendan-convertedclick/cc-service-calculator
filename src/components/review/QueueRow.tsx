import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReviewItem } from "@/types/client-review";

export interface QueueRowProps {
  item: ReviewItem;
  /** Highlights the row: bg-m-surface-container-high. */
  selected: boolean;
  /** True while this row's decision is in flight — disables the ✓, shows a spinner. */
  busy: boolean;
  /** True when pending, dated, and past due — renders the Overdue badge. */
  overdue: boolean;
  onSelect: (id: string) => void;
  /**
   * The hover ✓. Only rendered when item.state === "pending".
   * The page routes this through the same identity resolution as the detail
   * pane buttons — it is NOT a shortcut past "And you are?".
   */
  onQuickApprove: (id: string) => void;
}

export function QueueRow({ item, selected, busy, overdue, onSelect, onQuickApprove }: QueueRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => {
        // The quick-approve <button> is inside this row; its own keydown
        // (e.g. Enter/Space to activate it) bubbles up here too. Only treat
        // the row itself as activated, or keyboard use of the ✓ would select
        // the row instead of approving.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-2 border-b border-m-outline-variant p-3 text-left transition-colors last:border-b-0",
        selected ? "bg-m-surface-container-high" : "hover:bg-m-surface-container",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-title-small text-m-on-surface">{item.client_title}</p>
        <p className="mt-0.5 truncate text-body-medium text-m-on-surface-variant">{item.ask}</p>
        {overdue || item.weighty ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {overdue ? (
              <Badge className="border-transparent bg-m-error-container text-m-on-error-container">
                Overdue
              </Badge>
            ) : null}
            {item.weighty ? <Badge variant="outline">Needs a formal sign-off</Badge> : null}
          </div>
        ) : null}
      </div>

      {item.state === "pending" ? (
        <button
          type="button"
          aria-label="Quick approve"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onQuickApprove(item.id);
          }}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-m-on-surface-variant opacity-100 transition-opacity hover:bg-m-surface-container-highest hover:text-m-primary disabled:opacity-100",
            "lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      ) : null}
    </div>
  );
}
