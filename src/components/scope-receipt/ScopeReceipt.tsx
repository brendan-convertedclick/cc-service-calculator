import { useMemo, useState } from "react";
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
  className,
}: ScopeReceiptProps) {
  const [clientView, setClientView] = useState(false);
  // Local, non-destructive override + qty edits — re-bucket / re-total without
  // a round-trip. onOverride (if supplied) persists the disposition too.
  const [overrides, setOverrides] = useState<Record<string, Disposition>>({});
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});

  const adjusted = useMemo(
    () =>
      placements.map((p) =>
        p.task_ref in qtyOverrides
          ? { ...p, quantity: qtyOverrides[p.task_ref] }
          : p,
      ),
    [placements, qtyOverrides],
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
              onOverride={handleOverride}
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
