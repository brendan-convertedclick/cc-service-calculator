import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Money } from "@/components/ui/money";
import type { ReceiptBucket } from "@/lib/scope-receipt";
import type { Disposition } from "@/types/sow-placements";
import { ServiceLineRow } from "./ServiceLineRow";

// Band accent styling by tone. emerald=included, amber=billable, grey=out.
// Deliberately NOT the violet m-primary-container (reserved for the map chip).
// Distilled: tinted zones, not bordered cards — the band already sits inside
// the stage card, so a second card border reads as nesting. Colour + dot +
// title carry the grouping instead.
const TONE_ACCENT: Record<ReceiptBucket["tone"], string> = {
  included: "bg-emerald-50/60",
  billable: "bg-amber-50/60",
  out: "bg-m-surface-container/40",
};

const TONE_DOT: Record<ReceiptBucket["tone"], string> = {
  included: "bg-emerald-500",
  billable: "bg-amber-400",
  out: "bg-m-outline-variant",
};

const TONE_TITLE: Record<ReceiptBucket["tone"], string> = {
  included: "text-emerald-800",
  billable: "text-amber-800",
  out: "text-m-on-surface-variant",
};

// A 1px tone-matched border delineates the band from the stage card behind it.
// Billable (the quote) gets the most visible outline; the others stay quiet.
const TONE_BORDER: Record<ReceiptBucket["tone"], string> = {
  included: "border border-emerald-200/70",
  billable: "border border-amber-300/80",
  out: "border border-m-outline-variant",
};

export interface BucketBandProps {
  bucket: ReceiptBucket;
  /** Show R0 covered hint instead of selling prices (included band). */
  covered?: boolean;
  /** Strike line totals (out-of-scope band). */
  struck?: boolean;
  /** Collapsible + collapsed by default (out-of-scope band). */
  collapsible?: boolean;
  /** Render the subtotal in the header (billable band only). */
  showSubtotal?: boolean;
  clientMode?: boolean;
  onQtyChange?: (taskRef: string, qty: number) => void;
  onPriceChange?: (taskRef: string, unitCents: number) => void;
  /** Inline title edit — enables the editable name + description fields. */
  onPersistName?: (taskRef: string, name: string) => void;
  onPersistDescription?: (taskRef: string, description: string) => void;
  onOverride?: (taskRef: string, disposition: Disposition) => void;
  /** Untick control — toggles a line's excluded flag (operator view). */
  onToggleExcluded?: (taskRef: string, excluded: boolean) => void;
  /** Inline edit of the client-facing coverage reason. */
  onPersistReason?: (taskRef: string, reason: string) => void;
  /** Expandable per-line detail (team task breakdown). */
  renderLineDetail?: (taskRef: string) => ReactNode;
  /** One-line rollup shown under each line name. */
  lineSummary?: (taskRef: string) => ReactNode;
  /**
   * Footer slot under the line stack (e.g. "+ Add billable line"). When present,
   * the band always renders in full — even with zero lines — so the affordance
   * stays reachable on an empty band.
   */
  footer?: ReactNode;
}

/**
 * One disposition band: a header (title + count + optional subtotal) over a
 * stack of ServiceLineRow. Always rendered even when empty — an empty band
 * degrades to a thin "None" header so the three-bucket shape stays legible.
 */
export function BucketBand({
  bucket,
  covered = false,
  struck = false,
  collapsible = false,
  showSubtotal = false,
  clientMode = false,
  onQtyChange,
  onPriceChange,
  onPersistName,
  onPersistDescription,
  onOverride,
  onToggleExcluded,
  onPersistReason,
  renderLineDetail,
  lineSummary,
  footer,
}: BucketBandProps) {
  // A footer (e.g. "+ Add billable line") keeps the band in its full form even
  // with no lines, so the empty "None" degradation only applies without one.
  const empty = bucket.lines.length === 0 && !footer;
  const [open, setOpen] = useState(!collapsible);

  // Confidence chips only matter on the lines the operator should sanity-check
  // — the billable + out-of-scope (lower-trust) bands, never the included one.
  const showConfidence = bucket.tone !== "included";

  if (empty) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-4 py-2",
          TONE_ACCENT[bucket.tone],
          TONE_BORDER[bucket.tone],
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", TONE_DOT[bucket.tone])} />
        <span className={cn("text-label-medium font-medium", TONE_TITLE[bucket.tone])}>
          {bucket.title}
        </span>
        <span className="ml-auto text-label-small text-m-on-surface-variant">None</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg",
        TONE_ACCENT[bucket.tone],
        TONE_BORDER[bucket.tone],
      )}
    >
      <button
        type="button"
        disabled={!collapsible}
        onClick={() => collapsible && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2.5 text-left",
          collapsible && "transition-colors hover:bg-m-surface/40",
        )}
        aria-expanded={collapsible ? open : undefined}
      >
        <span className={cn("h-2 w-2 rounded-full", TONE_DOT[bucket.tone])} />
        <span className={cn("text-label-medium font-semibold", TONE_TITLE[bucket.tone])}>
          {bucket.title}
        </span>
        <span className="text-label-small text-m-on-surface-variant">
          {bucket.lines.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {covered && (
            <span className="text-label-small font-medium text-emerald-700">
              <Money cents={0} /> covered
            </span>
          )}
          {showSubtotal && (
            <span className="text-body-medium font-semibold text-amber-800">
              <Money cents={bucket.subtotalCents} />
            </span>
          )}
          {collapsible && (
            <ChevronDown
              className={cn(
                "h-4 w-4 text-m-on-surface-variant transition-transform",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          )}
        </div>
      </button>

      {open && (
        <div className="divide-y divide-m-outline-variant/60 border-t border-m-outline-variant/60 bg-m-surface">
          {bucket.lines.map((line) => (
            <ServiceLineRow
              key={line.taskRef}
              line={covered ? { ...line, lineCents: 0, unitCents: 0 } : line}
              struck={struck}
              clientMode={clientMode}
              showConfidence={showConfidence}
              onQtyChange={onQtyChange}
              onPriceChange={onPriceChange}
              onPersistName={onPersistName}
              onPersistDescription={onPersistDescription}
              onOverride={onOverride}
              onToggleExcluded={onToggleExcluded}
              onPersistReason={onPersistReason}
              renderDetail={renderLineDetail}
              detailSummary={lineSummary?.(line.taskRef)}
            />
          ))}
          {footer}
        </div>
      )}
    </div>
  );
}
