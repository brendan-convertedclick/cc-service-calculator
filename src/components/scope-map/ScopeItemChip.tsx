import { Check, ArrowDownRight, ArrowUpLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { BriefTaskSowPlacement } from "@/types/sow-placements";

export interface ScopeItemChipProps {
  item: BriefTaskSowPlacement;
  /** Layout-space coordinates (0..size, typically 0..800). */
  x: number;
  y: number;
  /** Layout-space size the x/y coordinates were computed in. */
  size: number;
  /** Whether this (outside) item is selected for the cost estimate. */
  selected: boolean;
  onToggleSelect: (ref: string) => void;
  onOverride: (ref: string, isInside: boolean) => void;
}

/**
 * A single ask rendered as a positioned pill on the scope map. Clicking the
 * chip opens a Radix popover with the AI reasoning + override actions.
 * Outside chips carry a leading checkbox that toggles inclusion in the cost
 * estimate without opening the popover.
 */
export function ScopeItemChip({
  item,
  x,
  y,
  size,
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
            "absolute z-10 flex max-w-[150px] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-label-medium shadow-elev-1 motion-safe:transition-all motion-safe:duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            item.is_inside
              ? "bg-m-primary-container text-m-on-primary-container"
              : "bg-m-error-container text-m-on-error-container",
            lowConfidence
              ? "border-2 border-dashed border-m-outline ring-1 ring-m-outline-variant"
              : "border border-transparent",
          )}
          style={{
            left: `${(x / size) * 100}%`,
            top: `${(y / size) * 100}%`,
          }}
        >
          {!item.is_inside && (
            // A real <button> cannot nest inside the trigger button, so the
            // estimate checkbox is a span with checkbox semantics. Clicks
            // stop propagation so they never toggle the popover.
            <span
              role="checkbox"
              aria-checked={selected}
              aria-label={`Include "${name}" in estimate`}
              data-testid={`chip-select-${item.task_ref}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(item.task_ref);
              }}
              className={cn(
                "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                selected
                  ? "border-m-error bg-m-error text-m-on-error"
                  : "border-m-on-error-container/50 bg-m-surface/60",
              )}
            >
              {selected && <Check className="h-3 w-3" />}
            </span>
          )}
          <span className="truncate">{name}</span>
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
