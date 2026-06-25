import { useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import { Eye, Wrench } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/format";
import { ServiceLineRow } from "@/components/scope-receipt/ServiceLineRow";
import { BAND_TITLE } from "@/lib/scope-receipt";
import type { ResolvedSection } from "@/lib/sow-doc";
import type { VariableBag } from "@/types/sow-composer";
import { MergeFieldChip } from "./MergeFieldChip";

export interface SowDocPreviewProps {
  sections: ResolvedSection[];
  bag: VariableBag;
  billableTotalCents: number;
}

/**
 * Read-only render of a resolved SOW — the client-facing artefact. The same
 * ResolvedSowDoc drives the PDF, so what the operator sees here is exactly what
 * ships. The operator/client switch hides internal-only affordances (the
 * out-of-scope band and confidence chips), mirroring ScopeReceipt.
 */
export function SowDocPreview({
  sections,
  bag,
  billableTotalCents,
}: SowDocPreviewProps) {
  const [clientView, setClientView] = useState(false);

  const totalVar = bag["pricing.total_incl_vat_cents"];
  const grandTotalCents =
    totalVar && typeof totalVar.value === "number" ? totalVar.value : billableTotalCents;
  const grandTotalLabel = totalVar ? "Total (incl VAT)" : "Billable total";

  return (
    <div className="flex h-full flex-col rounded-lg border border-m-outline-variant bg-m-surface">
      <div className="flex items-center justify-between border-b border-m-outline-variant px-4 py-2.5">
        <span className="text-title-small text-m-on-surface">Preview</span>
        <div className="flex items-center gap-2">
          {clientView ? (
            <Eye className="h-4 w-4 text-m-on-surface-variant" />
          ) : (
            <Wrench className="h-4 w-4 text-m-on-surface-variant" />
          )}
          <Label htmlFor="sow-client-view" className="text-label-medium text-m-on-surface-variant">
            Client view
          </Label>
          <Switch id="sow-client-view" checked={clientView} onCheckedChange={setClientView} />
        </div>
      </div>

      <div data-testid="sow-preview" className="flex-1 space-y-6 overflow-y-auto p-6">
        {sections.length === 0 && (
          <p className="text-body-medium text-m-on-surface-variant">
            This SOW has no sections yet. Add one from the left.
          </p>
        )}

        {sections.map((section) => (
          <section key={section.id} data-testid={`preview-section-${section.id}`} className="space-y-2">
            {section.heading && (
              <h3 className="text-title-medium text-m-on-surface">{section.heading}</h3>
            )}

            {section.kind === "prose" && (
              <div className="space-y-2">
                <div data-color-mode="light" className="text-body-medium text-m-on-surface">
                  <MDEditor.Markdown
                    source={section.resolvedMarkdown}
                    style={{ background: "transparent", color: "inherit" }}
                  />
                </div>
                {section.tokens.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {section.tokens.map((t) => (
                      <MergeFieldChip key={t.key} token={t} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {section.kind === "service_table" && (
              <div className="overflow-hidden rounded-md border border-m-outline-variant">
                {section.receipt.buckets
                  .filter((b) => !(clientView && b.disposition === "out_of_scope"))
                  .filter((b) => b.lines.length > 0)
                  .map((bucket) => (
                    <div key={bucket.disposition}>
                      <div className="bg-m-surface-container px-4 py-1.5 text-label-medium font-medium text-m-on-surface-variant">
                        {BAND_TITLE[bucket.disposition]}
                      </div>
                      {bucket.lines.map((line) => (
                        <div
                          key={line.taskRef}
                          data-testid={`line-${line.taskRef}`}
                          data-cents={line.lineCents}
                          className="border-t border-m-outline-variant"
                        >
                          <ServiceLineRow
                            line={line}
                            clientMode={clientView}
                            struck={bucket.disposition === "out_of_scope"}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                <div
                  className="flex items-center justify-between border-t border-m-outline-variant bg-m-surface-container-high px-4 py-2"
                  data-testid={`section-subtotal-${section.id}`}
                  data-cents={section.receipt.billableTotalCents}
                >
                  <span className="text-label-medium text-m-on-surface-variant">Billable subtotal</span>
                  <span className="text-body-medium font-semibold tabular-nums text-m-on-surface">
                    {formatCurrency(section.receipt.billableTotalCents / 100)}
                  </span>
                </div>
              </div>
            )}

            {section.kind === "list" && (
              <ul className="list-disc space-y-1 pl-5 text-body-medium text-m-on-surface">
                {section.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}

            {section.kind === "clause" && (
              <p className="rounded bg-m-surface-container px-3 py-2 text-body-small italic text-m-on-surface-variant">
                Clause <span className="font-mono">{section.clauseKey}</span> — resolved on render.
              </p>
            )}

            {section.kind === "signature" && (
              <div className="grid grid-cols-2 gap-6 pt-4">
                {["Client", "Converted Click"].map((who) => (
                  <div key={who} className="space-y-1">
                    <div className="h-10 border-b border-m-outline" />
                    <span className="text-label-small text-m-on-surface-variant">{who}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <Separator />
      <div className="flex items-center justify-between px-6 py-3">
        <span className="text-title-small text-m-on-surface">{grandTotalLabel}</span>
        <span
          data-testid="sow-total"
          data-cents={grandTotalCents}
          className="text-headline-small font-semibold tabular-nums text-m-on-surface"
        >
          {formatCurrency(grandTotalCents / 100)}
        </span>
      </div>
    </div>
  );
}
