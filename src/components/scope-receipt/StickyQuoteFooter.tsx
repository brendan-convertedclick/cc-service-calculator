import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { rollupCE } from "@/types/change-estimates";
import type { ScopeReceiptModel } from "@/lib/scope-receipt";

export interface StickyQuoteFooterProps {
  model: ScopeReceiptModel;
  /** Optional retainer allowance meter rendered above the total row. */
  meter?: React.ReactNode;
  /** Primary CTA — usually "Build cost estimate". */
  onBuildEstimate?: () => void;
  buildLabel?: string;
  disabled?: boolean;
}

/**
 * Sticky receipt footer. The live grand total is the sum of new_billable lines
 * only, computed through the shared rollupCE() helper (same money path as
 * EstimateSheet) so the receipt and the estimate sheet can never disagree.
 */
export function StickyQuoteFooter({
  model,
  meter,
  onBuildEstimate,
  buildLabel = "Build cost estimate",
  disabled = false,
}: StickyQuoteFooterProps) {
  const billable = model.buckets.find((b) => b.disposition === "new_billable");
  const billableLines = billable?.lines ?? [];

  // Reuse the EstimateSheet rollup: every billable line is an `add` so the
  // delta_value_cents equals the receipt's amber subtotal — single source of
  // truth for the money rather than a parallel sum.
  const { delta_value_cents } = rollupCE(
    billableLines.map((l, i) => ({
      id: l.taskRef,
      change_estimate_id: "receipt",
      service_id: null,
      description: l.name,
      qty: l.qty,
      unit_points: 0,
      unit_value_cents: l.unitCents,
      line_kind: "add" as const,
      target_task_id: null,
      sort_order: i,
    })),
  );

  const newCount = model.counts.new_billable;

  return (
    <div className="sticky bottom-4 z-20">
      <Card className="border-m-outline-variant bg-m-surface-container shadow-elev-3">
        <CardContent className="space-y-3 px-5 py-3">
          {meter}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-label-small text-m-on-surface-variant">
                {model.counts.in_agreed_scope} included ·{" "}
                {newCount} new billable ·{" "}
                {model.counts.out_of_scope} out of scope — only billable lines are
                quoted
              </p>
              <p className="text-headline-small text-m-on-surface">
                <Money cents={delta_value_cents} />
                <span className="ml-1 text-label-medium font-normal text-m-on-surface-variant">
                  to quote
                </span>
              </p>
            </div>
            {onBuildEstimate && (
              <Button
                onClick={onBuildEstimate}
                disabled={disabled || newCount === 0}
                className="gap-2"
              >
                <Calculator className="h-4 w-4" />
                {buildLabel}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
