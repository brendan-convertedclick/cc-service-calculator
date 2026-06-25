import { Check, ArrowDownRight, ArrowUpLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { BriefTaskSowPlacement } from "@/types/sow-placements";

export interface ScopeItemChipProps {
  item: BriefTaskSowPlacement;
  /** Whether this (outside) item is selected for the cost estimate. */
  selected: boolean;
  onToggleSelect: (ref: string) => void;
  onOverride: (ref: string, isInside: boolean) => void;
}

/**
 * A single ask rendered as a full-width row inside one of the scope-map
 * columns. Clicking the row opens a Radix popover with the AI reasoning +
 * override actions. Outside rows carry a leading checkbox that toggles
 * inclusion in the cost estimate without opening the popover.
 */
export function ScopeItemChip({
  item,
  selected,
  onToggleSelect,
  onOverride,
}: ScopeItemChipProps) {
  const name = item.item_name ?? item.task_ref;
  const confidence = item.ai_confidence;
  const lowConfidence = confidence !== null && confidence < 0.55;
  const verdict = item.is_inside ? "In SOW" : "Outside SOW";
  const ariaLabel = [
    name,
    verdict,
    item.is_inside ? null : selected ? "Included in estimate" : "Not included in estimate",
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
            "group flex w-full items-center gap-2.5 rounded-lg border bg-m-surface px-3 py-2.5 text-left shadow-elev-1 transition-colors hover:bg-m-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            lowConfidence
              ? "border-dashed border-m-outline"
              : "border-m-outline-variant",
          )}
        >
          {!item.is_inside && (
            // Purely decorative mouse shortcut — a real control cannot nest
            // inside the trigger button, so the operable checkbox lives in
            // the popover and selection state is announced via the row
            // button's aria-label. Clicks stop propagation so they never
            // toggle the popover.
            <span
              aria-hidden="true"
              data-testid={`chip-select-${item.task_ref}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(item.task_ref);
              }}
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                selected
                  ? "border-m-error bg-m-error text-m-on-error"
                  : "border-m-outline bg-m-surface",
              )}
            >
              {selected && <Check className="h-3 w-3" />}
            </span>
          )}
          <span className="min-w-0 flex-1 text-label-large text-m-on-surface">
            {name}
          </span>
          {confidence !== null && (
            <span
              className={cn(
                "shrink-0 tabular-nums text-label-small",
                lowConfidence ? "text-m-tertiary" : "text-m-on-surface-variant",
              )}
            >
              {Math.round(confidence * 100)}%
            </span>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 text-m-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100" />
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
          {item.item_description && (
            <p className="text-body-small text-m-on-surface-variant">{item.item_description}</p>
          )}
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
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => onOverride(item.task_ref, true)}
              >
                <ArrowUpLeft className="h-3.5 w-3.5" />
                Move inside
              </Button>
              <label className="flex cursor-pointer items-center gap-2 text-label-medium text-m-on-surface">
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => onToggleSelect(item.task_ref)}
                  aria-label={`Include "${name}" in estimate`}
                />
                Include in estimate
              </label>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
