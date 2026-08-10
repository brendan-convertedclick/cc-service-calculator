// src/pages/SowComposer.tsx
//
// The Scope Composer — a two-pane visual SOW builder. Left: a typed section
// outline editor + a "fill these in" variable panel. Right: a live preview
// driven by the single pure resolveSowDocument() resolver (the same one the
// golden tests and the Scenarios runner use), so edit / preview / PDF never
// drift. Routes: /sow/docs/:id (instance) and /sow/templates/:id (template).

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useServices } from "@/hooks/useServices";
import {
  useClientVariableOverrides,
  useSowDocument,
  useSowTemplate,
  useSowVariables,
  useUpdateClientVariableOverrides,
  useUpsertSowDocument,
} from "@/hooks/useSowComposer";
import { resolveSowDocument } from "@/lib/sow-doc";
import { todayISO } from "@/lib/dates";
import { errorMessage } from "@/lib/utils";
import type { ReceiptCatalogService } from "@/lib/scope-receipt";
import type { OverrideMap, SowBody, SowScenario } from "@/types/sow-composer";
import { SectionList } from "@/components/sow-composer/SectionList";
import { VariablePanel } from "@/components/sow-composer/VariablePanel";
import { ScenariosBar } from "@/components/sow-composer/ScenariosBar";
import { SowDocPreview } from "@/components/sow-composer/SowDocPreview";

const LIVE_SCENARIO = "Live values";

export function SowComposer() {
  const { id } = useParams<{ id: string }>();
  const { pathname } = useLocation();
  const mode: "doc" | "template" = pathname.includes("/templates/") ? "template" : "doc";

  const docQuery = useSowDocument(mode === "doc" ? id : undefined);
  const templateQuery = useSowTemplate(mode === "template" ? id : undefined);
  const row = mode === "doc" ? docQuery.data : templateQuery.data;
  const loading = mode === "doc" ? docQuery.isLoading : templateQuery.isLoading;

  const templateId = mode === "doc" ? docQuery.data?.template_id ?? null : id ?? null;
  const { data: registry = [] } = useSowVariables(templateId);
  const { data: services } = useServices();
  const clientId = mode === "doc" ? docQuery.data?.client_id ?? undefined : undefined;
  const { data: clientOverrides = {} } = useClientVariableOverrides(clientId);

  const upsert = useUpsertSowDocument();
  const updateClient = useUpdateClientVariableOverrides();

  // ── Local, editable document state (hydrated once per loaded row) ────────────
  const [title, setTitle] = useState("");
  const [body, setBody] = useState<SowBody>([]);
  const [docOverrides, setDocOverrides] = useState<OverrideMap>({});
  const [activeScenario, setActiveScenario] = useState(LIVE_SCENARIO);
  const [validated, setValidated] = useState(false);
  const hydratedRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!row || hydratedRef.current === row.id) return;
    setTitle("title" in row ? row.title : row.name);
    setBody(row.body ?? []);
    setDocOverrides("variable_overrides" in row ? (row.variable_overrides ?? {}) : {});
    hydratedRef.current = row.id;
    dirtyRef.current = false;
    setValidated(false);
  }, [row]);

  // ── Debounced autosave (doc mode only) ───────────────────────────────────────
  useEffect(() => {
    if (mode !== "doc" || !id || !dirtyRef.current) return;
    const t = setTimeout(() => {
      upsert.mutate({ id, title, body, variable_overrides: docOverrides });
    }, 600);
    return () => clearTimeout(t);
  }, [body, docOverrides, title, id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const serviceById = useMemo(
    () =>
      new Map<string, ReceiptCatalogService>(
        (services ?? []).map((s) => [
          s.id,
          {
            id: s.id,
            code: s.code,
            name: s.name,
            sell_price_cents: s.sell_price_cents,
            unit_of_sale: s.unit_of_sale,
          },
        ]),
      ),
    [services],
  );
  const serviceList = useMemo<ReceiptCatalogService[]>(
    () => [...serviceById.values()],
    [serviceById],
  );

  // ── Built-in what-if scenarios (per-doc storage lands in phase 2) ────────────
  const scenarios = useMemo<SowScenario[]>(() => {
    const out: SowScenario[] = [{ name: LIVE_SCENARIO, overrides: {} }];
    if (registry.some((d) => d.key === "agency.vat_pct")) {
      out.push({ name: "WHAT-IF 25% VAT", overrides: { "agency.vat_pct": 25 } });
      out.push({ name: "WHAT-IF no VAT", overrides: { "agency.vat_pct": 0 } });
    }
    return out;
  }, [registry]);

  const scenarioOverrides =
    scenarios.find((s) => s.name === activeScenario)?.overrides ?? {};

  // ── The one resolve call shared with the tests + scenarios runner ────────────
  const resolved = useMemo(() => {
    try {
      return resolveSowDocument({
        body,
        registry,
        recordValues: { "document.date": todayISO() },
        clientOverrides,
        docOverrides,
        scenarioOverrides,
        serviceById,
      });
    } catch (e) {
      toast.error(`Could not resolve document: ${errorMessage(e)}`);
      return null;
    }
  }, [body, registry, clientOverrides, docOverrides, scenarioOverrides, serviceById]);

  const variableKeys = useMemo(() => registry.map((d) => d.key), [registry]);

  const handleBodyChange = (next: SowBody) => {
    dirtyRef.current = true;
    setBody(next);
    setValidated(false);
  };
  const handleSetDocOverride = (key: string, value: unknown) => {
    dirtyRef.current = true;
    setDocOverrides((prev) => ({ ...prev, [key]: value }));
    setValidated(false);
  };
  const handleSetClientOverride = (key: string, value: unknown) => {
    if (!clientId) {
      toast.error("This SOW has no client yet.");
      return;
    }
    updateClient.mutate(
      { clientId, overrides: { ...clientOverrides, [key]: value } },
      {
        onSuccess: () => toast.success(`Applied ${key} to this client`),
        onError: (e) => toast.error(`Could not apply: ${errorMessage(e)}`),
      },
    );
  };

  const handleValidate = () => {
    setValidated(true);
    if (resolved && !resolved.lint.ok) {
      toast.error(
        `Unknown variable${resolved.lint.unknownVariables.length === 1 ? "" : "s"}: ${resolved.lint.unknownVariables.join(", ")}`,
      );
    } else {
      toast.success("SOW is valid");
    }
  };

  const handleFinalize = () => {
    if (mode !== "doc" || !id || !resolved?.lint.ok) return;
    upsert.mutate(
      { id, status: "final" },
      {
        onSuccess: () => toast.success("Marked final"),
        onError: (e) => toast.error(`Could not finalize: ${errorMessage(e)}`),
      },
    );
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="p-6">
        <h1 className="text-headline-small text-m-on-surface">SOW not found</h1>
        <p className="mt-2 text-body-medium text-m-on-surface-variant">
          No {mode === "doc" ? "document" : "template"} with id <span className="font-mono">{id}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6" key={id}>
      <div className="flex items-center gap-3">
        <Input
          aria-label="SOW title"
          value={title}
          onChange={(e) => {
            dirtyRef.current = true;
            setTitle(e.target.value);
          }}
          className="h-10 max-w-md text-title-medium"
        />
        {mode === "template" && (
          <span className="rounded-md bg-m-secondary-container px-2 py-0.5 text-label-small text-m-on-secondary-container">
            Template
          </span>
        )}
      </div>

      <ScenariosBar
        scenarios={scenarios}
        activeName={activeScenario}
        onSelect={setActiveScenario}
        lint={resolved?.lint ?? { unknownVariables: [], ok: true }}
        validated={validated}
        onValidate={handleValidate}
        onFinalize={handleFinalize}
      />

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
        <div className="space-y-4 overflow-y-auto pb-6">
          <SectionList
            body={body}
            onChange={handleBodyChange}
            serviceById={serviceById}
            services={serviceList}
            variableKeys={variableKeys}
          />
          {resolved && (
            <VariablePanel
              registry={registry}
              bag={resolved.bag}
              docOverrides={docOverrides}
              onSetDocOverride={handleSetDocOverride}
              onSetClientOverride={clientId ? handleSetClientOverride : undefined}
            />
          )}
        </div>

        <div className="min-h-0">
          {resolved && (
            <SowDocPreview
              sections={resolved.doc.sections}
              bag={resolved.bag}
              billableTotalCents={resolved.billableTotalCents}
            />
          )}
        </div>
      </div>
    </div>
  );
}
