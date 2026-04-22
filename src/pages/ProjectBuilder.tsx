import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QuoteLineEditor, type EditorLine } from "@/components/QuoteLineEditor";
import { SOWPreview } from "@/components/SOWPreview";
import { AISuggestModal, type Suggestion } from "@/components/AISuggestModal";
import { ServicePicker } from "@/components/ServicePicker";
import { useBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { useScope } from "@/hooks/useScopes";
import { useServices } from "@/hooks/useServices";
import { useDepartments } from "@/hooks/useDepartments";
import {
  useCreateQuote,
  useLiveQuoteForScope,
  useReplaceQuoteServices,
  useUpdateQuote,
} from "@/hooks/useQuotes";
import { aggregateTotals, buildLineItems, type QuoteLine } from "@/lib/quotes";
import { supabase } from "@/lib/supabase";
import masterSows from "@/data/master-sows.json";
import { formatZar } from "@/lib/utils";

export function ProjectBuilder() {
  const { id: briefId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: brief } = useBrief(briefId);
  const { data: scope } = useScope(briefId);
  const { data: services = [] } = useServices();
  const { data: depts = [] } = useDepartments();
  const { data: liveQuote } = useLiveQuoteForScope(scope?.id);
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
  const [drafting, setDrafting] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [hydratedForQuote, setHydratedForQuote] = useState<string | null>(null);

  // Ensure a draft quote exists for this scope.
  useEffect(() => {
    if (!scope || liveQuote || createQuote.isPending) return;
    void createQuote.mutateAsync({ scope_id: scope.id, version: 1, status: "draft" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.id, liveQuote?.id]);

  // Hydrate editor state from the live quote on first load of that quote id.
  useEffect(() => {
    if (!liveQuote || hydratedForQuote === liveQuote.id) return;
    setMarginPct(Number(liveQuote.margin_pct));
    setDiscountPct(Number(liveQuote.discount_room_pct));
    setSowHtml(liveQuote.sow_html ?? "");
    void (async () => {
      const { data } = await supabase
        .from("quote_services")
        .select("*")
        .eq("quote_id", liveQuote.id)
        .order("ordinal");
      setLines(
        (data ?? []).map((r): EditorLine => ({
          service_id: r.service_id,
          qty: Number(r.qty),
          allocation: (r.allocation_override as Record<string, number> | null) ?? {},
          hours: (r.hours_override as Record<string, number> | null) ?? {},
        })),
      );
      setHydratedForQuote(liveQuote.id);
    })();
  }, [liveQuote, hydratedForQuote]);

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

  async function saveLines() {
    if (!liveQuote) return;
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
  }

  async function aiSuggest() {
    if (!briefId) return;
    const { data, error } = await supabase.functions.invoke("suggest-services", {
      body: { brief_id: briefId },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setSuggestions(
      (data.suggestions as Array<{ service_id: string; qty: number; confidence: number; reasoning: string }>).map(
        (s) => ({
          ...s,
          service_name: services.find((x) => x.id === s.service_id)?.name ?? "Unknown",
        }),
      ),
    );
    setSuggestOpen(true);
  }

  async function draftSow() {
    if (!liveQuote) return;
    setDrafting(true);
    await saveLines();
    const { data, error } = await supabase.functions.invoke("draft-sow", {
      body: { quote_id: liveQuote.id, master_sows: masterSows },
    });
    setDrafting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSowHtml(data.sow_html);
    await updateQuote.mutateAsync({ id: liveQuote.id, patch: { sow_html: data.sow_html } });
    toast.success("SOW drafted");
  }

  async function finalise() {
    if (!liveQuote || !briefId) return;
    setFinalising(true);
    await saveLines();
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
    const { data: pdfRes, error: pdfErr } = await supabase.functions.invoke("render-sow-pdf", {
      body: { quote_id: liveQuote.id },
    });
    if (pdfErr) {
      setFinalising(false);
      toast.error(`PDF render failed: ${pdfErr.message}`);
      return;
    }
    await updateQuote.mutateAsync({ id: liveQuote.id, patch: { sow_pdf_url: pdfRes.url } });
    await updateBrief.mutateAsync({ id: briefId, patch: { status: "quoted" } });
    setFinalising(false);
    navigate(`/quotes/${liveQuote.id}/send`);
  }

  const excludeIds = useMemo(() => new Set(lines.map((l) => l.service_id)), [lines]);

  if (!brief || !scope) return <div className="p-6">Loading…</div>;

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-[minmax(280px,340px)_1fr_minmax(320px,440px)] gap-4 p-4">
      <aside className="overflow-auto space-y-3">
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="text-title-small">Locked scope</h2>
            <div className="text-body-small whitespace-pre-wrap">{scope.enhanced_prose}</div>
            <Tabs defaultValue="in">
              <TabsList>
                <TabsTrigger value="in">In</TabsTrigger>
                <TabsTrigger value="out">Out</TabsTrigger>
                <TabsTrigger value="q">Questions</TabsTrigger>
              </TabsList>
              <TabsContent value="in">
                <pre className="text-body-small whitespace-pre-wrap">{scope.in_scope_md}</pre>
              </TabsContent>
              <TabsContent value="out">
                <pre className="text-body-small whitespace-pre-wrap">{scope.out_of_scope_md}</pre>
              </TabsContent>
              <TabsContent value="q">
                <pre className="text-body-small whitespace-pre-wrap">{scope.open_questions_md}</pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </aside>

      <section className="overflow-auto space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ServicePicker excludeIds={excludeIds} onPick={addService} />
          </div>
          <Button variant="secondary" onClick={aiSuggest}>AI suggest services</Button>
          <Button variant="secondary" onClick={draftSow} disabled={drafting || lines.length === 0}>
            {drafting ? "Drafting…" : "Draft SOW"}
          </Button>
        </div>

        {lines.map((l, i) => {
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
              onRemove={() => setLines((prev) => prev.filter((x) => x.service_id !== l.service_id))}
            />
          );
        })}

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Margin %</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={marginPct}
                  onChange={(e) => setMarginPct(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Discount room %</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={discountPct}
                  onChange={(e) => setDiscountPct(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Total</Label>
                <div className="text-title-medium">{formatZar(totals.total_cents)}</div>
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={saveLines}>Save draft</Button>
              <Button
                onClick={finalise}
                disabled={lines.length === 0 || !sowHtml || finalising}
              >
                {finalising ? "Finalising…" : "Finalise quote"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <aside className="overflow-hidden">
        <SOWPreview html={sowHtml} onChange={setSowHtml} />
      </aside>

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
