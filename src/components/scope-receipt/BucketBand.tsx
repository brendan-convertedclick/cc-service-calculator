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
  onOverride?: (taskRef: string, disposition: Disposition) => void;
  /** Expandable per-line detail (team task breakdown). */
  renderLineDetail?: (taskRef: string) => ReactNode;
  /** One-line rollup shown under each line name. */
  lineSummary?: (taskRef: string) => string | undefined;
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
  onOverride,
  renderLineDetail,
  lineSummary,
}: BucketBandProps) {
  const empty = bucket.lines.length === 0;
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
    <div className={cn("overflow-hidden rounded-lg", TONE_ACCENT[bucket.tone])}>
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
              onOverride={onOverride}
              renderDetail={renderLineDetail}
              detailSummary={lineSummary?.(line.taskRef)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
