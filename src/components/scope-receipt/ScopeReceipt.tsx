import { useMemo, useState, type ReactNode } from "react";
import { Eye, Wrench } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  buildScopeReceipt,
  type ReceiptCatalogService,
} from "@/lib/scope-receipt";
import type {
  BriefTaskSowPlacement,
  Disposition,
} from "@/types/sow-placements";
import { CoverageBar } from "./CoverageBar";
import { BucketBand } from "./BucketBand";
import {
  RetainerAllowanceMeter,
  type RetainerAllowanceMeterProps,
} from "./RetainerAllowanceMeter";
import { StickyQuoteFooter } from "./StickyQuoteFooter";

export interface ScopeReceiptProps {
  placements: BriefTaskSowPlacement[];
  /** Catalog keyed by service id (suggested_service_id) — code, price, unit. */
  serviceById: Map<string, ReceiptCatalogService>;
  /**
   * Retainer allowance meter input. Omit when the client has no retainer
   * allowance for any quoted service — the meter is then hidden entirely.
   */
  meter?: Omit<RetainerAllowanceMeterProps, "quoteAdds">;
  onBuildEstimate?: () => void;
  /**
   * Persist a per-line disposition override (optional). The receipt re-buckets
   * locally regardless; pass this to also write the change back to the server.
   */
  onOverride?: (taskRef: string, disposition: Disposition) => void;
  /** Persist an inline quantity edit (optional). Local re-total happens regardless. */
  onPersistQty?: (taskRef: string, qty: number) => void;
  /** Persist an inline unit-price edit in cents (optional). Enables price editing. */
  onPersistPrice?: (taskRef: string, unitCents: number) => void;
  /**
   * Expandable per-line detail for billable lines (the team task breakdown that
   * goes to ClickUp). When provided, each billable line gets an expand chevron.
   */
  renderLineDetail?: (taskRef: string) => ReactNode;
  /** One-line rollup under each billable line name (e.g. "2 tasks · 3.5h · 22pt"). */
  lineSummary?: (taskRef: string) => string | undefined;
  className?: string;
}

/**
 * The Scope Receipt: a client-facing artefact that decomposes an inbound
 * request into three fixed bands — Included (already paid for), New billable
 * (quoted), and Out of scope (not offered). Operators see confidence chips,
 * the out-of-scope band, per-line ⋮ overrides and the retainer meter; clients
 * see a clean three-bucket summary with only the billable total.
 *
 * Everything is derived from the placement records via buildScopeReceipt — no
 * per-client branching, just the operator/client view flag.
 */
export function ScopeReceipt({
  placements,
  serviceById,
  meter,
  onBuildEstimate,
  onOverride,
  onPersistQty,
  onPersistPrice,
  renderLineDetail,
  lineSummary,
  className,
}: ScopeReceiptProps) {
  const [clientView, setClientView] = useState(false);
  // Local, non-destructive override + qty/price edits — re-bucket / re-total
  // without a round-trip. The onPersist* callbacks (if supplied) also write the
  // change back to the server.
  const [overrides, setOverrides] = useState<Record<string, Disposition>>({});
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});

  const adjusted = useMemo(
    () =>
      placements.map((p) => {
        let next = p;
        if (p.task_ref in qtyOverrides) next = { ...next, quantity: qtyOverrides[p.task_ref] };
        if (p.task_ref in priceOverrides)
          next = { ...next, estimated_cents: priceOverrides[p.task_ref] };
        return next;
      }),
    [placements, qtyOverrides, priceOverrides],
  );

  const model = useMemo(
    () => buildScopeReceipt(adjusted, serviceById, overrides),
    [adjusted, serviceById, overrides],
  );

  const handleOverride = (taskRef: string, disposition: Disposition) => {
    setOverrides((prev) => ({ ...prev, [taskRef]: disposition }));
    onOverride?.(taskRef, disposition);
  };

  const handleQtyChange = (taskRef: string, qty: number) => {
    setQtyOverrides((prev) => ({ ...prev, [taskRef]: qty }));
    onPersistQty?.(taskRef, qty);
  };

  const handlePriceChange = (taskRef: string, unitCents: number) => {
    setPriceOverrides((prev) => ({ ...prev, [taskRef]: unitCents }));
    onPersistPrice?.(taskRef, unitCents);
  };

  const clientMode = clientView;

  // The quote adds = new_billable line count this quote contributes. The meter
  // is the client artefact, so it never renders in client view.
  const meterNode =
    meter && !clientMode ? (
      <RetainerAllowanceMeter
        {...meter}
        quoteAdds={model.counts.new_billable}
      />
    ) : undefined;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <CoverageBar model={model} clientMode={clientMode} />
        <label className="flex shrink-0 items-center gap-2">
          {clientMode ? (
            <Eye className="h-4 w-4 text-m-on-surface-variant" />
          ) : (
            <Wrench className="h-4 w-4 text-m-on-surface-variant" />
          )}
          <Label htmlFor="scope-receipt-view" className="cursor-pointer text-label-medium">
            {clientMode ? "Client view" : "Operator view"}
          </Label>
          <Switch
            id="scope-receipt-view"
            checked={clientMode}
            onCheckedChange={setClientView}
            aria-label="Toggle client view"
          />
        </label>
      </div>

      <div className="space-y-3">
        {model.buckets.map((bucket) => {
          if (bucket.disposition === "out_of_scope" && clientMode) return null;
          const isIncluded = bucket.disposition === "in_agreed_scope";
          const isBillable = bucket.disposition === "new_billable";
          const isOut = bucket.disposition === "out_of_scope";
          return (
            <BucketBand
              key={bucket.disposition}
              bucket={bucket}
              covered={isIncluded}
              struck={isOut}
              collapsible={isOut}
              showSubtotal={isBillable}
              clientMode={clientMode}
              onQtyChange={isBillable ? handleQtyChange : undefined}
              onPriceChange={isBillable ? handlePriceChange : undefined}
              onOverride={handleOverride}
              renderLineDetail={isBillable ? renderLineDetail : undefined}
              lineSummary={isBillable ? lineSummary : undefined}
            />
          );
        })}
      </div>

      <StickyQuoteFooter
        model={model}
        meter={meterNode}
        onBuildEstimate={onBuildEstimate}
      />
    </div>
  );
}

export default ScopeReceipt;
