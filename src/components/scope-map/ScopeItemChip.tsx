import { Check, ArrowDownRight, ArrowUpLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfidenceBars } from "@/components/scope-map/ConfidenceBars";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { BriefTaskSowPlacement } from "@/types/sow-placements";

export interface ScopeItemChipProps {
  item: BriefTaskSowPlacement;
  /** Whether this item is selected for the cost estimate. */
  selected: boolean;
  onToggleSelect: (ref: string) => void;
  onOverride: (ref: string, isInside: boolean) => void;
}

/**
 * A short, client-ready one-liner explaining why this ask is in or out of
 * scope. Prefers the analysis's own description; falls back to a disposition
 * default so a synopsis always shows.
 */
function synopsisFor(item: BriefTaskSowPlacement): string {
  const desc = item.item_description?.trim();
  if (desc) return desc;
  switch (item.disposition) {
    case "in_agreed_scope":
      return "Covered by the current agreement — no extra charge.";
    case "new_billable":
      return "Not in the current agreement — quoted as new work.";
    case "out_of_scope":
      return "Outside the services we provide.";
    default:
      return item.is_inside
        ? "Covered by the current scope."
        : "Outside the current scope.";
  }
}

/**
 * A single ask rendered as a full-width row inside one of the scope-map
 * columns: a checkbox (include in the cost estimate), the ask name, a short
 * why-it's-in/out synopsis, and the confidence. Clicking the row opens a
 * popover with the AI reasoning + override actions. The leading checkbox
 * toggles estimate inclusion without opening the popover.
 */
export function ScopeItemChip({
  item,
  selected,
  onToggleSelect,
  onOverride,
}: ScopeItemChipProps) {
  const name = item.item_name ?? item.task_ref;
  const synopsis = synopsisFor(item);
  const confidence = item.ai_confidence;
  const lowConfidence = confidence !== null && confidence < 0.55;
  const verdict = item.is_inside ? "In SOW" : "Outside SOW";
  const ariaLabel = [
    name,
    verdict,
    selected ? "Included in estimate" : "Not included in estimate",
    item.ai_match_quote ? `Reasoning: ${item.ai_match_quote}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "group flex w-full items-start gap-2.5 rounded-lg border bg-m-surface px-3 py-2.5 text-left shadow-elev-1 transition-colors hover:bg-m-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            lowConfidence
              ? "border-dashed border-m-outline"
              : "border-m-outline-variant",
          )}
        >
          {/* Purely decorative mouse shortcut — a real control cannot nest
              inside the trigger button, so the operable checkbox lives in the
              popover and selection state is announced via the row button's
              aria-label. Clicks stop propagation so they never toggle the
              popover. Available on every row so any ask can be added to the CE. */}
          <span
            aria-hidden="true"
            data-testid={`chip-select-${item.task_ref}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(item.task_ref);
            }}
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
              selected
                ? "border-m-primary bg-m-primary text-m-on-primary"
                : "border-m-outline bg-m-surface",
            )}
          >
            {selected && <Check className="h-3 w-3" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-label-large text-m-on-surface">{name}</span>
            <span className="mt-0.5 block text-body-small text-m-on-surface-variant">
              {synopsis}
            </span>
          </span>
          {confidence !== null && (
            <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
              <ConfidenceBars value={confidence} />
              <span className="tabular-nums text-label-small text-m-on-surface-variant">
                {Math.round(confidence * 100)}%
              </span>
            </span>
          )}
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-m-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" sideOffset={8}>
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-title-small text-m-on-surface">{name}</h3>
            <Badge variant={item.is_inside ? "muted" : "destructive"} className="shrink-0">
              {item.is_inside && item.sow_slug ? `${verdict} · ${item.sow_slug}` : verdict}
            </Badge>
          </div>
          <p className="text-body-small text-m-on-surface-variant">{synopsis}</p>
        </div>

        {confidence !== null && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-label-small text-m-on-surface-variant">
              <span>Confidence</span>
              <span>{Math.round(confidence * 100)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-m-surface-container">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  lowConfidence ? "bg-m-tertiary" : "bg-m-primary",
                )}
                style={{ width: `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {item.ai_match_quote && (
          <blockquote className="border-l-2 border-m-outline-variant pl-2 text-body-small italic text-m-on-surface-variant">
            {item.ai_match_quote}
          </blockquote>
        )}

        {!item.is_inside && (item.suggested_service_id || item.estimated_cents !== null) && (
          <p className="text-body-small text-m-on-surface">
            {item.suggested_service_id ? "Matched catalogue service" : "Ballpark estimate"}
            {item.estimated_cents !== null && (
              <span className="ml-1 font-medium">
                {formatCurrency(item.estimated_cents / 100)}
              </span>
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {item.is_inside ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => onOverride(item.task_ref, false)}
            >
              <ArrowDownRight className="h-3.5 w-3.5" />
              Move outside
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => onOverride(item.task_ref, true)}
            >
              <ArrowUpLeft className="h-3.5 w-3.5" />
              Move inside
            </Button>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-label-medium text-m-on-surface">
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect(item.task_ref)}
              aria-label={`Include "${name}" in estimate`}
            />
            Include in estimate
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
