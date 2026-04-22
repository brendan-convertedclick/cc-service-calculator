import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { useScope } from "@/hooks/useScopes";
import { useServices } from "@/hooks/useServices";
import { useDepartments } from "@/hooks/useDepartments";
import { useClients } from "@/hooks/useClients";
import { useAllocationMatrix } from "@/hooks/useAllocationMatrix";
import {
  useCreateQuote,
  useLiveQuoteForScope,
  useQuote,
  useReplaceQuoteLineItems,
  useReplaceQuoteServices,
  useUpdateQuote,
} from "@/hooks/useQuotes";
import type { EditorLine } from "@/components/QuoteLineEditor";
import { aggregateTotals, buildLineItems, type QuoteLine } from "@/lib/quotes";
import type { Suggestion } from "@/components/AISuggestModal";

export type UseQuoteBuilderResult = {
  // domain refs
  brief: ReturnType<typeof useBrief>["data"];
  scope: ReturnType<typeof useScope>["data"];
  services: ReturnType<typeof useServices>["data"];
  depts: ReturnType<typeof useDepartments>["data"];
  clientName: string | undefined;
  liveQuote: ReturnType<typeof useLiveQuoteForScope>["data"];

  // editor state
  lines: EditorLine[];
  setLines: React.Dispatch<React.SetStateAction<EditorLine[]>>;
  marginPct: number;
  setMarginPct: (n: number) => void;
  discountPct: number;
  setDiscountPct: (n: number) => void;
  sowHtml: string;
  setSowHtml: (s: string) => void;

  // computed
  lineTotals: QuoteLine[];
  totals: { subtotal_cents: number; total_cents: number };
  excludeIds: Set<string>;

  // AI suggestions UI state
  suggestOpen: boolean;
  setSuggestOpen: (b: boolean) => void;
  suggestions: Suggestion[];

  // status flags
  suggesting: boolean;
  drafting: boolean;
  saving: boolean;
  finalising: boolean;
  ready: boolean;
  canFinalise: boolean;
  finaliseHint: string | null;

  // actions
  addService: (serviceId: string) => void;
  removeLine: (serviceId: string) => void;
  patchLine: (index: number, patch: Partial<EditorLine>) => void;
  saveLines: (silent?: boolean) => Promise<void>;
  aiSuggest: () => Promise<void>;
  acceptSuggestions: (accepted: Suggestion[]) => void;
  draftSow: () => Promise<void>;
  finalise: () => Promise<void>;
};

export function useQuoteBuilder(briefId: string | undefined): UseQuoteBuilderResult {
  const navigate = useNavigate();
  const { data: brief } = useBrief(briefId);
  const { data: scope } = useScope(briefId);
  const { data: services = [] } = useServices();
  const { data: depts = [] } = useDepartments();
  const { data: clients = [] } = useClients();
  const { data: matrix } = useAllocationMatrix();
  const { data: liveQuote } = useLiveQuoteForScope(scope?.id);
  const { data: quoteData } = useQuote(liveQuote?.id);
  const createQuote = useCreateQuote();
  const updateQuote = useUpdateQuote();
  const replaceSvcs = useReplaceQuoteServices();
  const replaceLineItems = useReplaceQuoteLineItems();
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

  const totals = useMemo(
    () => aggregateTotals(lineTotals, { margin_pct: marginPct, discount_room_pct: discountPct }),
    [lineTotals, marginPct, discountPct],
  );

  function addService(serviceId: string) {
    if (lines.some((l) => l.service_id === serviceId)) return;
    const byDept = matrix?.resolved[serviceId] ?? {};
    const allocation: Record<string, number> = {};
    const hours: Record<string, number> = {};
    for (const [deptId, entry] of Object.entries(byDept)) {
      allocation[deptId] = Number(entry.pct ?? 0);
      hours[deptId] = Number(entry.hours ?? 0);
    }
    setLines((prev) => [...prev, { service_id: serviceId, qty: 1, allocation, hours }]);
  }

  const removeLine = useCallback((serviceId: string) => {
    setLines((prev) => prev.filter((x) => x.service_id !== serviceId));
  }, []);

  const patchLine = useCallback((index: number, patch: Partial<EditorLine>) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = {
        ...prev[index],
        ...patch,
        allocation: patch.allocation ?? prev[index].allocation,
        hours: patch.hours ?? prev[index].hours,
      };
      return next;
    });
  }, []);

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

  function acceptSuggestions(accepted: Suggestion[]) {
    for (const s of accepted) addService(s.service_id);
  }

  async function draftSow() {
    if (!liveQuote) return;
    try {
      setDrafting(true);
      await saveLines(true);
      const { data, error } = await supabase.functions.invoke("draft-sow", {
        body: { quote_id: liveQuote.id },
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
          subtotal_cents: totals.subtotal_cents,
          total_cents: totals.total_cents,
          margin_pct: marginPct,
          discount_room_pct: discountPct,
          sow_html: sowHtml,
        },
      });
      await replaceLineItems.mutateAsync({ quoteId: liveQuote.id, snapshot });
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
  const ready = Boolean(brief && scope);
  const canFinalise = lines.length > 0 && !finalising;
  const finaliseHint = lines.length === 0 ? "Add at least one service to finalise" : null;

  return {
    brief,
    scope,
    services,
    depts,
    clientName,
    liveQuote,
    lines,
    setLines,
    marginPct,
    setMarginPct,
    discountPct,
    setDiscountPct,
    sowHtml,
    setSowHtml,
    lineTotals,
    totals,
    excludeIds,
    suggestOpen,
    setSuggestOpen,
    suggestions,
    suggesting,
    drafting,
    saving,
    finalising,
    ready,
    canFinalise,
    finaliseHint,
    addService,
    removeLine,
    patchLine,
    saveLines,
    aiSuggest,
    acceptSuggestions,
    draftSow,
    finalise,
  };
}
