import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, Minus, MoreVertical, Plus, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Money } from "@/components/ui/money";
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

/** Always show at least one decimal place (1 → "1.0", 1.5 → "1.5"). */
function formatQty(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/**
 * Inline-editable number cell. Shows a formatted display value when idle; on
 * focus it swaps to a raw, editable seed (selected whole so a keystroke
 * replaces it), and commits the parsed value on blur / Enter — Escape cancels.
 * Kept uncontrolled-by-display so external re-renders (optimistic writes) never
 * fight the operator's keystrokes.
 */
function InlineNumber({
  display,
  seed,
  onCommit,
  ariaLabel,
  align = "right",
  widthClass,
}: {
  display: string;
  seed: string;
  onCommit: (text: string) => void;
  ariaLabel: string;
  align?: "right" | "center";
  widthClass?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // null = not editing (show formatted display); string = the in-flight draft.
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const editing = draft !== null;

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={editing ? draft : display}
      onFocus={() => {
        setDraft(seed);
        // Select after React has swapped the value to the seed, so the first
        // keystroke replaces the whole number instead of inserting mid-string.
        requestAnimationFrame(() => ref.current?.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const value = draft ?? "";
        const cancelled = cancelledRef.current;
        cancelledRef.current = false;
        setDraft(null);
        if (!cancelled) onCommit(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelledRef.current = true;
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "rounded border border-transparent bg-transparent px-1 py-0.5 font-mono tabular-nums",
        "hover:border-m-outline-variant focus:border-m-primary focus:bg-m-surface focus:outline-none",
        align === "right" ? "text-right" : "text-center",
        widthClass,
      )}
    />
  );
}

export interface ServiceLineRowProps {
  line: ReceiptLine;
  /** out_of_scope rows render the line total struck through. */
  struck?: boolean;
  /** Hide the confidence chip + ⋮ override (client artefact). */
  clientMode?: boolean;
  /** Whether to show the confidence chip for this row (amber/grey med-low). */
  showConfidence?: boolean;
  onQtyChange?: (taskRef: string, qty: number) => void;
  /** Inline unit-price edit (cents). Enables the editable price cell. */
  onPriceChange?: (taskRef: string, unitCents: number) => void;
  onOverride?: (taskRef: string, disposition: Disposition) => void;
  /**
   * Expandable drop-down content for this line (the team task breakdown that
   * goes to ClickUp). When provided, the row gets an expand chevron.
   */
  renderDetail?: (taskRef: string) => ReactNode;
  /** One-line rollup shown under the name (e.g. "2 tasks · 3.5h · 22pt"). */
  detailSummary?: string;
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
  onPriceChange,
  onOverride,
  renderDetail,
  detailSummary,
}: ServiceLineRowProps) {
  const editableQty = !clientMode && !!onQtyChange;
  const editablePrice = !clientMode && !!onPriceChange;
  const hasDetail = !clientMode && !!renderDetail;
  const [expanded, setExpanded] = useState(false);
  const step = () => (line.qty % 1 === 0 ? 1 : 0.25);

  const commitQty = (t: string) => {
    const n = parseFloat(t.replace(",", "."));
    if (Number.isFinite(n) && n > 0) onQtyChange?.(line.taskRef, Math.round(n * 100) / 100);
  };
  const commitPrice = (t: string) => {
    const rands = parseFloat(t.replace(/[^\d.,]/g, "").replace(",", "."));
    if (Number.isFinite(rands) && rands >= 0) onPriceChange?.(line.taskRef, Math.round(rands * 100));
  };

  return (
    <div>
    <div className="flex items-center gap-3 px-4 py-2.5">
      {hasDetail && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} team tasks for ${line.name}`}
          className="shrink-0 rounded p-0.5 text-m-on-surface-variant hover:bg-m-surface-container"
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
          />
        </button>
      )}
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
        {hasDetail && detailSummary && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 text-label-small text-m-on-surface-variant hover:text-m-primary"
          >
            {detailSummary}
          </button>
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
        {editableQty ? (
          <InlineNumber
            display={formatQty(line.qty)}
            seed={String(line.qty)}
            onCommit={commitQty}
            ariaLabel={`Quantity for ${line.name}`}
            align="center"
            widthClass="w-12 text-body-small text-m-on-surface"
          />
        ) : (
          <span className="min-w-[2ch] text-center text-body-small font-mono tabular-nums text-m-on-surface">
            {formatQty(line.qty)}
          </span>
        )}
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
      {editablePrice ? (
        <InlineNumber
          display={formatCurrency(line.unitCents / 100)}
          seed={String(line.unitCents / 100)}
          onCommit={commitPrice}
          ariaLabel={`Unit price for ${line.name}`}
          widthClass="w-20 shrink-0 text-label-small text-m-on-surface-variant"
        />
      ) : (
        <Money
          cents={line.unitCents}
          className="w-20 shrink-0 text-right text-label-small text-m-on-surface-variant"
        />
      )}

      {/* line total */}
      <Money
        cents={line.lineCents}
        className={cn(
          "w-24 shrink-0 text-right text-body-medium",
          struck
            ? "text-m-on-surface-variant line-through"
            : "font-medium text-m-on-surface",
        )}
      />

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

      {hasDetail && expanded && (
        <div className="px-4 pb-3 pl-11">{renderDetail!(line.taskRef)}</div>
      )}
    </div>
  );
}
