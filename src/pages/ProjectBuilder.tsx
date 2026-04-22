import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Check, ChevronDown, FileText, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuoteLineEditor, type EditorLine } from "@/components/QuoteLineEditor";
import { SOWPreview } from "@/components/SOWPreview";
import { AISuggestModal, type Suggestion } from "@/components/AISuggestModal";
import { ServicePicker } from "@/components/ServicePicker";
import { useBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { useScope } from "@/hooks/useScopes";
import { useServices } from "@/hooks/useServices";
import { useDepartments } from "@/hooks/useDepartments";
import { useClients } from "@/hooks/useClients";
import {
  useCreateQuote,
  useLiveQuoteForScope,
  useQuote,
  useReplaceQuoteServices,
  useUpdateQuote,
} from "@/hooks/useQuotes";
import { aggregateTotals, buildLineItems, type QuoteLine } from "@/lib/quotes";
import { supabase } from "@/lib/supabase";
import masterSows from "@/data/master-sows.json";
import { formatZar } from "@/lib/utils";

const STEPS = [
  { key: "scope", label: "Scope" },
  { key: "build", label: "Build" },
  { key: "quote", label: "Quote" },
  { key: "send", label: "Send" },
] as const;

function ProgressStepper({ current }: { current: "scope" | "build" | "quote" | "send" }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-label-small">
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full border " +
                (done
                  ? "border-m-primary bg-m-primary text-m-on-primary"
                  : active
                  ? "border-m-primary text-m-primary"
                  : "border-m-outline-variant text-m-on-surface-variant")
              }
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={
                active
                  ? "text-m-on-surface"
                  : done
                  ? "text-m-on-surface-variant"
                  : "text-m-on-surface-variant/70"
              }
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 h-px w-8 bg-m-outline-variant" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ScopeSidebar({
  prose,
  inMd,
  outMd,
  qMd,
}: {
  prose: string | null;
  inMd: string | null;
  outMd: string | null;
  qMd: string | null;
}) {
  const sections = [
    { title: "In scope", body: inMd },
    { title: "Out of scope", body: outMd },
    { title: "Open questions", body: qMd },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-label-small uppercase tracking-wider text-m-on-surface-variant">
          Locked scope
        </div>
      </div>
      {prose && (
        <p className="text-body-medium leading-relaxed text-m-on-surface">{prose}</p>
      )}
      <div className="space-y-1">
        {sections.map((s) =>
          s.body?.trim() ? (
            <details
              key={s.title}
              open
              className="group rounded-md border border-m-outline-variant bg-m-surface"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
                <span className="text-title-small">{s.title}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-m-on-surface-variant transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-m-outline-variant px-3 py-2">
                <pre className="whitespace-pre-wrap font-sans text-body-small leading-relaxed text-m-on-surface">
                  {s.body}
                </pre>
              </div>
            </details>
          ) : null,
        )}
      </div>
    </div>
  );
}

function EmptyLines({
  onAiSuggest,
  suggesting,
}: {
  onAiSuggest: () => void;
  suggesting: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-m-outline-variant bg-m-surface-container/40 px-8 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-m-primary-container text-m-on-primary-container">
        <Sparkles className="h-6 w-6" />
      </div>
      <h3 className="text-title-medium">Start with AI suggestions</h3>
      <p className="mt-2 max-w-md text-body-medium text-m-on-surface-variant">
        Let the assistant read the locked scope and propose a matching set of services from your
        catalogue. You can tweak or remove any before finalising.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={onAiSuggest} disabled={suggesting}>
          <Wand2 className="h-4 w-4" />
          {suggesting ? "Thinking…" : "Suggest services from scope"}
        </Button>
        <span className="text-label-small text-m-on-surface-variant">
          or search the catalogue above
        </span>
      </div>
    </div>
  );
}

function SOWPanel({
  html,
  onChange,
  onDraft,
  drafting,
  canDraft,
}: {
  html: string;
  onChange: (html: string) => void;
  onDraft: () => void;
  drafting: boolean;
  canDraft: boolean;
}) {
  if (!html) {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-label-small uppercase tracking-wider text-m-on-surface-variant">
          Statement of work
        </div>
        <div className="flex items-center gap-3 rounded-md border border-m-outline-variant bg-m-surface p-3">
          <FileText className="h-5 w-5 shrink-0 text-m-on-surface-variant" />
          <div className="min-w-0 flex-1">
            <div className="text-body-small text-m-on-surface">No SOW drafted yet</div>
            <div className="text-label-small text-m-on-surface-variant">
              {canDraft
                ? "Draft once line items are settled"
                : "Add a service to enable"}
            </div>
          </div>
          <Button size="sm" onClick={onDraft} disabled={!canDraft || drafting}>
            {drafting ? "Drafting…" : "Draft SOW"}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-label-small uppercase tracking-wider text-m-on-surface-variant">
          Statement of work
        </div>
        <Button variant="secondary" size="sm" onClick={onDraft} disabled={drafting}>
          {drafting ? "Redrafting…" : "Redraft"}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <SOWPreview html={html} onChange={onChange} />
      </div>
    </div>
  );
}

export function ProjectBuilder() {
  const { id: briefId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: brief } = useBrief(briefId);
  const { data: scope } = useScope(briefId);
  const { data: services = [] } = useServices();
  const { data: depts = [] } = useDepartments();
  const { data: clients = [] } = useClients();
  const { data: liveQuote } = useLiveQuoteForScope(scope?.id);
  const { data: quoteData } = useQuote(liveQuote?.id);
  const createQuote = useCreateQuote();
  const updateQuote = useUpdateQuote();
  const replaceSvcs = useReplaceQuoteServices();
  const updateBrief = useUpdateBrief();

  const [lines, setLines] = useState<EditorLine[]>([]);
  const [marginPct, setMarginPct] = useState(0);
  const [discountPct, setDiscountPct] = useState(0);
  const [sowHtml, setSowHtml] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [hydratedForQuote, setHydratedForQuote] = useState<string | null>(null);

  useEffect(() => {
    if (!scope || liveQuote || createQuote.isPending) return;
    void createQuote.mutateAsync({ scope_id: scope.id, version: 1, status: "draft" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.id, liveQuote?.id]);

  useEffect(() => {
    if (!liveQuote || hydratedForQuote === liveQuote.id || !quoteData) return;
    setMarginPct(Number(liveQuote.margin_pct));
    setDiscountPct(Number(liveQuote.discount_room_pct));
    setSowHtml(liveQuote.sow_html ?? "");
    setLines(
      quoteData.services.map((r): EditorLine => ({
        service_id: r.service_id,
        qty: Number(r.qty),
        allocation: r.allocation_override,
        hours: r.hours_override,
      })),
    );
    setHydratedForQuote(liveQuote.id);
  }, [liveQuote, hydratedForQuote, quoteData]);

  const lineTotals = useMemo<QuoteLine[]>(() => {
    return lines.map((l) => {
      const svc = services.find((s) => s.id === l.service_id);
      return {
        service_id: l.service_id,
        service_name: svc?.name ?? "Unknown",
        xero_code: svc?.code ?? null,
        qty: l.qty,
        unit_price_cents: svc?.sell_price_cents ?? 0,
        allocation: Object.entries(l.allocation).map(([dept_id, pct]) => ({ dept_id, pct })),
      };
    });
  }, [lines, services]);

  const totals = aggregateTotals(lineTotals, {
    margin_pct: marginPct,
    discount_room_pct: discountPct,
  });

  async function addService(serviceId: string) {
    if (lines.some((l) => l.service_id === serviceId)) return;
    const { data: resolved } = await supabase
      .from("service_allocation_resolved")
      .select("*")
      .eq("service_id", serviceId);
    const allocation: Record<string, number> = {};
    const hours: Record<string, number> = {};
    for (const r of (resolved ?? []) as Array<{
      department_id: string;
      pct: number | null;
      hours: number | null;
    }>) {
      allocation[r.department_id] = Number(r.pct ?? 0);
      hours[r.department_id] = Number(r.hours ?? 0);
    }
    setLines((prev) => [...prev, { service_id: serviceId, qty: 1, allocation, hours }]);
  }

  async function saveLines(silent = false) {
    if (!liveQuote) return;
    try {
      setSaving(true);
      await replaceSvcs.mutateAsync({
        quoteId: liveQuote.id,
        rows: lines.map((l, i) => ({
          service_id: l.service_id,
          qty: l.qty,
          allocation_override: l.allocation,
          hours_override: l.hours,
          ordinal: i + 1,
          notes: null,
        })),
      });
      await updateQuote.mutateAsync({
        id: liveQuote.id,
        patch: { margin_pct: marginPct, discount_room_pct: discountPct },
      });
      if (!silent) toast.success("Draft saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function aiSuggest() {
    if (!briefId) return;
    try {
      setSuggesting(true);
      const { data, error } = await supabase.functions.invoke("suggest-services", {
        body: { brief_id: briefId },
      });
      if (error) throw error;
      setSuggestions(
        (data.suggestions as Array<{
          service_id: string;
          qty: number;
          confidence: number;
          reasoning: string;
        }>).map((s) => ({
          ...s,
          service_name: services.find((x) => x.id === s.service_id)?.name ?? "Unknown",
        })),
      );
      setSuggestOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI suggest failed");
    } finally {
      setSuggesting(false);
    }
  }

  async function draftSow() {
    if (!liveQuote) return;
    try {
      setDrafting(true);
      await saveLines(true);
      const { data, error } = await supabase.functions.invoke("draft-sow", {
        body: { quote_id: liveQuote.id, master_sows: masterSows },
      });
      if (error) throw error;
      setSowHtml(data.sow_html);
      await updateQuote.mutateAsync({ id: liveQuote.id, patch: { sow_html: data.sow_html } });
      toast.success("SOW drafted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft SOW failed");
    } finally {
      setDrafting(false);
    }
  }

  async function finalise() {
    if (!liveQuote || !briefId) return;
    try {
      setFinalising(true);
      await saveLines(true);
      const snapshot = buildLineItems(lineTotals, depts);
      await updateQuote.mutateAsync({
        id: liveQuote.id,
        patch: {
          line_items_jsonb: snapshot,
          subtotal_cents: totals.subtotal_cents,
          total_cents: totals.total_cents,
          margin_pct: marginPct,
          discount_room_pct: discountPct,
          sow_html: sowHtml,
        },
      });
      if (sowHtml) {
        const { data: pdfRes, error: pdfErr } = await supabase.functions.invoke("render-sow-pdf", {
          body: { quote_id: liveQuote.id },
        });
        if (pdfErr) throw pdfErr;
        await updateQuote.mutateAsync({ id: liveQuote.id, patch: { sow_pdf_url: pdfRes.url } });
      }
      await updateBrief.mutateAsync({ id: briefId, patch: { status: "quoted" } });
      navigate(`/quotes/${liveQuote.id}/send`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Finalise failed");
    } finally {
      setFinalising(false);
    }
  }

  const excludeIds = useMemo(() => new Set(lines.map((l) => l.service_id)), [lines]);
  const clientName = clients.find((c) => c.id === brief?.client_id)?.name;

  if (!brief || !scope) return <div className="p-6">Loading…</div>;

  const canFinalise = lines.length > 0 && !finalising;
  const finaliseHint = lines.length === 0 ? "Add at least one service to finalise" : null;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between border-b border-m-outline-variant bg-m-surface px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-label-small text-m-on-surface-variant">
            {clientName && <span>{clientName}</span>}
            {clientName && <span>·</span>}
            <span className="truncate">{brief.raw_subject ?? "Untitled brief"}</span>
          </div>
          <h1 className="text-headline-small">Build quote</h1>
        </div>
        <ProgressStepper current="build" />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,380px)_1fr] gap-6 overflow-hidden bg-m-surface-container-low px-6 pt-6">
        <aside className="flex min-h-0 flex-col gap-6 overflow-auto pb-6">
          <ScopeSidebar
            prose={scope.enhanced_prose}
            inMd={scope.in_scope_md}
            outMd={scope.out_of_scope_md}
            qMd={scope.open_questions_md}
          />
          <div className="border-t border-m-outline-variant pt-6">
            <SOWPanel
              html={sowHtml}
              onChange={setSowHtml}
              onDraft={draftSow}
              drafting={drafting}
              canDraft={lines.length > 0}
            />
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex-1">
              <ServicePicker excludeIds={excludeIds} onPick={addService} />
            </div>
            {lines.length > 0 && (
              <Button variant="secondary" onClick={aiSuggest} disabled={suggesting}>
                <Wand2 className="h-4 w-4" />
                {suggesting ? "Thinking…" : "AI suggest"}
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-auto pb-6">
            {lines.length === 0 ? (
              <EmptyLines onAiSuggest={aiSuggest} suggesting={suggesting} />
            ) : (
              lines.map((l, i) => {
                const svc = services.find((s) => s.id === l.service_id);
                if (!svc) return null;
                return (
                  <QuoteLineEditor
                    key={l.service_id}
                    line={l}
                    service={svc}
                    depts={depts}
                    onChange={(patch) => {
                      setLines((prev) => {
                        const next = [...prev];
                        next[i] = {
                          ...prev[i],
                          ...patch,
                          allocation: patch.allocation ?? prev[i].allocation,
                          hours: patch.hours ?? prev[i].hours,
                        };
                        return next;
                      });
                    }}
                    onRemove={() =>
                      setLines((prev) => prev.filter((x) => x.service_id !== l.service_id))
                    }
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
              <div className="text-title-small">{lines.length}</div>
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
                value={marginPct}
                onChange={(e) => setMarginPct(Number(e.target.value))}
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
                value={discountPct}
                onChange={(e) => setDiscountPct(Number(e.target.value))}
              />
            </div>
            <div className="h-8 w-px bg-m-outline-variant" />
            <div>
              <div className="text-label-small text-m-on-surface-variant">Subtotal</div>
              <div className="text-title-small tabular-nums">
                {formatZar(totals.subtotal_cents)}
              </div>
            </div>
            <div>
              <div className="text-label-small text-m-on-surface-variant">Total</div>
              <div className="text-headline-small tabular-nums text-m-primary">
                {formatZar(totals.total_cents)}
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {finaliseHint && (
              <span className="text-label-small text-m-on-surface-variant">{finaliseHint}</span>
            )}
            <Button variant="secondary" onClick={() => saveLines()} disabled={saving}>
              {saving ? "Saving…" : "Save draft"}
            </Button>
            <Button
              onClick={finalise}
              disabled={!canFinalise}
              title={finaliseHint ?? undefined}
            >
              {finalising ? "Finalising…" : "Finalise quote"}
            </Button>
          </div>
        </div>
      </footer>

      <AISuggestModal
        open={suggestOpen}
        suggestions={suggestions}
        onClose={() => setSuggestOpen(false)}
        onAccept={(accepted) => {
          setSuggestOpen(false);
          for (const s of accepted) void addService(s.service_id);
        }}
      />
    </div>
  );
}
