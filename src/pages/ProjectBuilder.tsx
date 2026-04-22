import { useParams } from "react-router-dom";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuoteLineEditor } from "@/components/QuoteLineEditor";
import { AISuggestModal } from "@/components/AISuggestModal";
import { ServicePicker } from "@/components/ServicePicker";
import { ProgressStepper } from "@/components/quote-builder/ProgressStepper";
import { ScopeSidebar } from "@/components/quote-builder/ScopeSidebar";
import { EmptyLines } from "@/components/quote-builder/EmptyLines";
import { SOWPanel } from "@/components/quote-builder/SOWPanel";
import { useQuoteBuilder } from "@/hooks/useQuoteBuilder";
import { formatZar } from "@/lib/utils";

export function ProjectBuilder() {
  const { id: briefId } = useParams<{ id: string }>();
  const qb = useQuoteBuilder(briefId);

  if (!qb.ready || !qb.brief || !qb.scope) return <div className="p-6">Loading…</div>;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between border-b border-m-outline-variant bg-m-surface px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-label-small text-m-on-surface-variant">
            {qb.clientName && <span>{qb.clientName}</span>}
            {qb.clientName && <span>·</span>}
            <span className="truncate">{qb.brief.raw_subject ?? "Untitled brief"}</span>
          </div>
          <h1 className="text-headline-small">Build quote</h1>
        </div>
        <ProgressStepper current="build" />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,380px)_1fr] gap-6 overflow-hidden bg-m-surface-container-low px-6 pt-6">
        <aside className="flex min-h-0 flex-col gap-6 overflow-auto pb-6">
          <ScopeSidebar
            prose={qb.scope.enhanced_prose}
            inMd={qb.scope.in_scope_md}
            outMd={qb.scope.out_of_scope_md}
            qMd={qb.scope.open_questions_md}
          />
          <div className="border-t border-m-outline-variant pt-6">
            <SOWPanel
              html={qb.sowHtml}
              onChange={qb.setSowHtml}
              onDraft={qb.draftSow}
              drafting={qb.drafting}
              canDraft={qb.lines.length > 0}
            />
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex-1">
              <ServicePicker excludeIds={qb.excludeIds} onPick={qb.addService} />
            </div>
            {qb.lines.length > 0 && (
              <Button variant="secondary" onClick={qb.aiSuggest} disabled={qb.suggesting}>
                <Wand2 className="h-4 w-4" />
                {qb.suggesting ? "Thinking…" : "AI suggest"}
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-auto pb-6">
            {qb.lines.length === 0 ? (
              <EmptyLines onAiSuggest={qb.aiSuggest} suggesting={qb.suggesting} />
            ) : (
              qb.lines.map((l, i) => {
                const svc = qb.services?.find((s) => s.id === l.service_id);
                if (!svc) return null;
                return (
                  <QuoteLineEditor
                    key={l.service_id}
                    line={l}
                    service={svc}
                    depts={qb.depts ?? []}
                    onChange={(patch) => qb.patchLine(i, patch)}
                    onRemove={() => qb.removeLine(l.service_id)}
                  />
                );
              })
            )}
          </div>
        </section>
      </div>

      <footer className="border-t border-m-outline-variant bg-m-surface shadow-elev-2">
        <div className="flex items-center gap-6 px-6 py-3">
          <div className="flex items-center gap-5 text-body-small">
            <div>
              <div className="text-label-small text-m-on-surface-variant">Lines</div>
              <div className="text-title-small">{qb.lines.length}</div>
            </div>
            <div className="h-8 w-px bg-m-outline-variant" />
            <div className="flex items-center gap-2">
              <Label htmlFor="margin-input" className="text-label-small text-m-on-surface-variant">
                Margin %
              </Label>
              <Input
                id="margin-input"
                type="number"
                step="0.5"
                className="h-9 w-20"
                value={qb.marginPct}
                onChange={(e) => qb.setMarginPct(Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="discount-input"
                className="text-label-small text-m-on-surface-variant"
              >
                Discount %
              </Label>
              <Input
                id="discount-input"
                type="number"
                step="0.5"
                className="h-9 w-20"
                value={qb.discountPct}
                onChange={(e) => qb.setDiscountPct(Number(e.target.value))}
              />
            </div>
            <div className="h-8 w-px bg-m-outline-variant" />
            <div>
              <div className="text-label-small text-m-on-surface-variant">Subtotal</div>
              <div className="text-title-small tabular-nums">
                {formatZar(qb.totals.subtotal_cents)}
              </div>
            </div>
            <div>
              <div className="text-label-small text-m-on-surface-variant">Total</div>
              <div className="text-headline-small tabular-nums text-m-primary">
                {formatZar(qb.totals.total_cents)}
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {qb.finaliseHint && (
              <span className="text-label-small text-m-on-surface-variant">{qb.finaliseHint}</span>
            )}
            <Button variant="secondary" onClick={() => qb.saveLines()} disabled={qb.saving}>
              {qb.saving ? "Saving…" : "Save draft"}
            </Button>
            <Button
              onClick={qb.finalise}
              disabled={!qb.canFinalise}
              title={qb.finaliseHint ?? undefined}
            >
              {qb.finalising ? "Finalising…" : "Finalise quote"}
            </Button>
          </div>
        </div>
      </footer>

      <AISuggestModal
        open={qb.suggestOpen}
        suggestions={qb.suggestions}
        onClose={() => qb.setSuggestOpen(false)}
        onAccept={(accepted) => {
          qb.setSuggestOpen(false);
          qb.acceptSuggestions(accepted);
        }}
      />
    </div>
  );
}
