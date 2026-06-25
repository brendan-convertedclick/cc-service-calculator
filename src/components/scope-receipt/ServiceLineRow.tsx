import { Minus, MoreVertical, Plus, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  BAND_TITLE,
  DISPOSITION_ORDER,
  type ReceiptLine,
} from "@/lib/scope-receipt";
import type { Disposition } from "@/types/sow-placements";
import { ConfidenceChip } from "./ConfidenceChip";

const OVERRIDE_LABEL: Record<Disposition, string> = {
  in_agreed_scope: "In",
  new_billable: "New",
  out_of_scope: "Out",
};

export interface ServiceLineRowProps {
  line: ReceiptLine;
  /** out_of_scope rows render the line total struck through. */
  struck?: boolean;
  /** Hide the confidence chip + ⋮ override (client artefact). */
  clientMode?: boolean;
  /** Whether to show the confidence chip for this row (amber/grey med-low). */
  showConfidence?: boolean;
  onQtyChange?: (taskRef: string, qty: number) => void;
  onOverride?: (taskRef: string, disposition: Disposition) => void;
}

/**
 * One receipt line: confidence chip · name + Xero code · qty stepper · unit
 * price · line total · ⋮ override. The ⋮ opens a Popover showing the verbatim
 * grounding quote plus an In/New/Out Tabs control that re-buckets the row.
 */
export function ServiceLineRow({
  line,
  struck = false,
  clientMode = false,
  showConfidence = false,
  onQtyChange,
  onOverride,
}: ServiceLineRowProps) {
  const editableQty = !clientMode && !!onQtyChange;
  const step = () => (line.qty % 1 === 0 ? 1 : 0.25);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {!clientMode && showConfidence && (
            <ConfidenceChip confidence={line.confidence} />
          )}
          <span className="truncate text-body-medium text-m-on-surface">
            {line.name}
          </span>
          {line.code && (
            <span className="rounded bg-m-surface-container px-1.5 py-0.5 font-mono text-label-small text-m-on-surface-variant">
              {line.code}
            </span>
          )}
        </div>
        {line.description && (
          <p className="mt-0.5 truncate text-label-small text-m-on-surface-variant">
            {line.description}
          </p>
        )}
      </div>

      {/* qty stepper */}
      <div className="flex shrink-0 items-center gap-1">
        {editableQty && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={`Decrease quantity for ${line.name}`}
            disabled={line.qty <= step()}
            onClick={() =>
              onQtyChange?.(line.taskRef, Math.max(step(), line.qty - step()))
            }
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
        )}
        <span className="min-w-[2ch] text-center text-body-small tabular-nums text-m-on-surface">
          {line.qty}
        </span>
        {editableQty && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={`Increase quantity for ${line.name}`}
            onClick={() => onQtyChange?.(line.taskRef, line.qty + step())}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
        {line.unit && (
          <span className="text-label-small text-m-on-surface-variant">
            {line.unit}
          </span>
        )}
      </div>

      {/* unit price */}
      <span className="w-20 shrink-0 text-right text-label-small tabular-nums text-m-on-surface-variant">
        {formatCurrency(line.unitCents / 100)}
      </span>

      {/* line total */}
      <span
        className={cn(
          "w-24 shrink-0 text-right text-body-medium tabular-nums",
          struck
            ? "text-m-on-surface-variant line-through"
            : "font-medium text-m-on-surface",
        )}
      >
        {formatCurrency(line.lineCents / 100)}
      </span>

      {/* ⋮ override */}
      {!clientMode && onOverride && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={`Override "${line.name}" — currently ${BAND_TITLE[line.disposition]}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-3" align="end" sideOffset={6}>
            <div className="space-y-1">
              <h4 className="text-title-small text-m-on-surface">{line.name}</h4>
              {line.confidence !== null && (
                <p className="text-label-small text-m-on-surface-variant">
                  Match confidence {Math.round(line.confidence * 100)}%
                  {line.needsReview && " · flagged for review"}
                </p>
              )}
            </div>

            {line.groundingQuote ? (
              <blockquote className="flex gap-1.5 border-l-2 border-m-outline-variant pl-2 text-body-small italic text-m-on-surface-variant">
                <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{line.groundingQuote}</span>
              </blockquote>
            ) : (
              <p className="text-label-small text-m-on-surface-variant">
                No grounding quote captured for this ask.
              </p>
            )}

            <div className="space-y-1.5">
              <p className="text-label-small font-medium text-m-on-surface-variant">
                Move to
              </p>
              <Tabs
                value={line.disposition}
                onValueChange={(v) =>
                  onOverride(line.taskRef, v as Disposition)
                }
              >
                <TabsList className="grid w-full grid-cols-3">
                  {DISPOSITION_ORDER.map((d) => (
                    <TabsTrigger key={d} value={d}>
                      {OVERRIDE_LABEL[d]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
