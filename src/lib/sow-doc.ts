// src/lib/sow-doc.ts
//
// Pure document resolver for the Scope Composer. Generalises buildScopeReceipt()
// from one rail into a whole SOW: each typed Section is resolved against the
// variable bag, and the SAME ResolvedSowDoc feeds the on-screen preview, the
// PDF renderer, and the golden tests — so edit / preview / PDF can never drift.
//
// service_table sections reuse buildScopeReceipt() unmodified and auto-publish
// their billable subtotal as `pricing.subtotal_cents`, which computed variables
// (e.g. total incl VAT) then consume.

import {
  buildScopeReceipt,
  type ReceiptCatalogService,
  type ScopeReceiptModel,
} from "@/lib/scope-receipt";
import { buildVariableBag } from "@/lib/sow-variables";
import { placementDisposition, type BriefTaskSowPlacement } from "@/types/sow-placements";
import type {
  OverrideMap,
  Section,
  ServiceTableLine,
  SowBody,
  VariableBag,
  VariableDef,
  VarSource,
} from "@/types/sow-composer";

// A {{key}} reference inside prose, resolved against the bag.
export interface ResolvedToken {
  key: string;
  known: boolean;
  formatted: string;
  source: VarSource | null;
}

export type ResolvedSection =
  | {
      kind: "prose";
      id: string;
      ordinal: number;
      heading?: string;
      resolvedMarkdown: string;
      tokens: ResolvedToken[];
    }
  | {
      kind: "service_table";
      id: string;
      ordinal: number;
      heading?: string;
      receipt: ScopeReceiptModel;
      showCostColumn: boolean;
    }
  | {
      kind: "clause";
      id: string;
      ordinal: number;
      heading?: string;
      clauseKey: string;
      clauseText: string | null;
    }
  | {
      kind: "list";
      id: string;
      ordinal: number;
      heading?: string;
      variant: "inclusions" | "exclusions";
      items: string[];
    }
  | { kind: "signature"; id: string; ordinal: number; heading?: string };

export interface ResolvedSowDoc {
  sections: ResolvedSection[];
  /** Sum of every service_table's billable (new_billable) total, in int cents. */
  billableTotalCents: number;
}

export interface SowLint {
  unknownVariables: string[];
  ok: boolean;
}

const PROSE_TOKEN_RE =
  /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}/g;

/** Map a service_table line onto the placement shape buildScopeReceipt expects. */
function lineToPlacement(l: ServiceTableLine): BriefTaskSowPlacement {
  return {
    id: l.taskRef,
    brief_id: "",
    task_ref: l.taskRef,
    service_area_id: null,
    is_inside: l.disposition === "in_agreed_scope",
    ai_match_quote: null,
    ai_confidence: null,
    override_reason: null,
    approved_by: null,
    approved_at: null,
    created_at: "",
    updated_at: "",
    item_name: l.name,
    item_description: l.description ?? null,
    sow_slug: null,
    suggested_service_id: l.serviceId ?? null,
    estimated_cents: l.unitCents,
    disposition: l.disposition,
    quantity: l.qty,
    grounding_quote: null,
    needs_review: null,
  };
}

function serviceTableReceipt(
  lines: ServiceTableLine[],
  serviceById: Map<string, ReceiptCatalogService>,
): ScopeReceiptModel {
  return buildScopeReceipt(lines.map(lineToPlacement), serviceById);
}

/** Billable subtotal across all service_table sections (int cents). */
export function computeSubtotalCents(
  body: SowBody,
  serviceById: Map<string, ReceiptCatalogService> = new Map(),
): number {
  let total = 0;
  for (const section of body) {
    if (section.type === "service_table") {
      total += serviceTableReceipt(section.props.lines, serviceById).billableTotalCents;
    }
  }
  return total;
}

function resolveProse(
  markdown: string,
  bag: VariableBag,
): { resolvedMarkdown: string; tokens: ResolvedToken[] } {
  const seen = new Map<string, ResolvedToken>();
  const resolvedMarkdown = markdown.replace(PROSE_TOKEN_RE, (_full, key: string) => {
    const rv = bag[key];
    const known = rv !== undefined;
    if (!seen.has(key)) {
      seen.set(key, {
        key,
        known,
        formatted: known ? rv.formatted : "",
        source: known ? rv.source : null,
      });
    }
    return known ? rv.formatted || "" : `{{${key}}}`;
  });
  return { resolvedMarkdown, tokens: [...seen.values()] };
}

/**
 * Resolve a SOW body against a variable bag into a render-ready document.
 * Pure: no React, no Supabase.
 */
export function resolveSowDoc(
  body: SowBody,
  bag: VariableBag,
  serviceById: Map<string, ReceiptCatalogService> = new Map(),
): ResolvedSowDoc {
  const ordered = [...body].sort((a, b) => a.ordinal - b.ordinal);
  let billableTotalCents = 0;
  const sections: ResolvedSection[] = ordered.map((section: Section): ResolvedSection => {
    switch (section.type) {
      case "prose": {
        const { resolvedMarkdown, tokens } = resolveProse(section.props.markdown, bag);
        return {
          kind: "prose",
          id: section.id,
          ordinal: section.ordinal,
          heading: section.props.heading,
          resolvedMarkdown,
          tokens,
        };
      }
      case "service_table": {
        const receipt = serviceTableReceipt(section.props.lines, serviceById);
        billableTotalCents += receipt.billableTotalCents;
        return {
          kind: "service_table",
          id: section.id,
          ordinal: section.ordinal,
          heading: section.props.heading,
          receipt,
          showCostColumn: section.props.showCostColumn ?? true,
        };
      }
      case "clause":
        return {
          kind: "clause",
          id: section.id,
          ordinal: section.ordinal,
          heading: section.props.heading,
          clauseKey: section.props.clauseKey,
          clauseText: null, // resolved live via resolve_sow_clause RPC (phase 2)
        };
      case "list":
        return {
          kind: "list",
          id: section.id,
          ordinal: section.ordinal,
          heading: section.props.heading,
          variant: section.props.variant,
          items: section.props.items,
        };
      case "signature":
        return {
          kind: "signature",
          id: section.id,
          ordinal: section.ordinal,
          heading: section.props.heading,
        };
    }
  });
  return { sections, billableTotalCents };
}

/** Pre-finalize checks: any prose token referencing an undefined variable. */
export function lintSowDoc(doc: ResolvedSowDoc): SowLint {
  const unknown = new Set<string>();
  for (const s of doc.sections) {
    if (s.kind === "prose") {
      for (const t of s.tokens) if (!t.known) unknown.add(t.key);
    }
  }
  const unknownVariables = [...unknown];
  return { unknownVariables, ok: unknownVariables.length === 0 };
}

// ── Orchestrator: the one call the UI, scenarios runner, and tests share ──────

export interface ResolveSowArgs {
  body: SowBody;
  registry: VariableDef[];
  /** client.name from the clients row, document.date = today, etc. */
  recordValues?: OverrideMap;
  /** clients.variable_overrides (sparse). */
  clientOverrides?: OverrideMap;
  /** sow_documents.variable_overrides (sparse). */
  docOverrides?: OverrideMap;
  /** Active "Scenarios" what-if set, layered on top of the document overrides. */
  scenarioOverrides?: OverrideMap;
  serviceById?: Map<string, ReceiptCatalogService>;
}

export interface ResolvedSowResult {
  bag: VariableBag;
  doc: ResolvedSowDoc;
  lint: SowLint;
  billableTotalCents: number;
}

/**
 * Resolve a whole SOW document: compute the service_table subtotal, auto-publish
 * it as pricing.subtotal_cents, build the variable bag with full override
 * precedence (scenario > document > client > record > registry), resolve every
 * section, and lint. Throws if a computed-variable cycle is present.
 */
export function resolveSowDocument(args: ResolveSowArgs): ResolvedSowResult {
  const serviceById = args.serviceById ?? new Map();
  const subtotal = computeSubtotalCents(args.body, serviceById);
  const recordValues: OverrideMap = {
    "pricing.subtotal_cents": subtotal,
    ...(args.recordValues ?? {}),
  };
  // Scenario overrides win over the saved document overrides.
  const docLayer: OverrideMap = {
    ...(args.docOverrides ?? {}),
    ...(args.scenarioOverrides ?? {}),
  };
  const bag = buildVariableBag(
    args.registry,
    recordValues,
    args.clientOverrides ?? {},
    docLayer,
  );
  const doc = resolveSowDoc(args.body, bag, serviceById);
  const lint = lintSowDoc(doc);
  return { bag, doc, lint, billableTotalCents: doc.billableTotalCents };
}

/**
 * Seed a SOW body from a brief's scope-rail placements — wiring the deterministic
 * scope analysis into the Composer. new_billable asks become service_table lines,
 * in_agreed_scope asks become an inclusions list, out_of_scope asks an exclusions
 * list. Pure, so it golden-tests like the rest of the rail.
 */
export function buildSowBodyFromPlacements(
  placements: BriefTaskSowPlacement[],
  serviceById: Map<string, ReceiptCatalogService> = new Map(),
): SowBody {
  const at = (d: BriefTaskSowPlacement["disposition"]) =>
    placements.filter((p) => placementDisposition(p) === d);
  const included = at("in_agreed_scope");
  const billable = at("new_billable");
  const excluded = at("out_of_scope");

  const lines: ServiceTableLine[] = billable.map((p) => {
    const svc = p.suggested_service_id ? serviceById.get(p.suggested_service_id) : undefined;
    return {
      taskRef: p.task_ref,
      name: p.item_name ?? p.task_ref,
      description: p.item_description ?? undefined,
      serviceId: p.suggested_service_id ?? null,
      qty: typeof p.quantity === "number" && p.quantity > 0 ? p.quantity : 1,
      unitCents: p.estimated_cents ?? svc?.sell_price_cents ?? 0,
      disposition: "new_billable",
    };
  });

  const body: SowBody = [];
  let ordinal = 0;
  body.push({
    id: "overview",
    type: "prose",
    ordinal: ordinal++,
    props: { heading: "Overview", markdown: "Scope of Work for **{{client.name}}**, dated {{document.date}}." },
  });
  if (included.length) {
    body.push({
      id: "included",
      type: "list",
      ordinal: ordinal++,
      props: { heading: "Included — already in scope", variant: "inclusions", items: included.map((p) => p.item_name ?? p.task_ref) },
    });
  }
  if (lines.length) {
    body.push({
      id: "deliverables",
      type: "service_table",
      ordinal: ordinal++,
      props: { heading: "New billable — deliverables & pricing", lines, showCostColumn: true },
    });
  }
  if (excluded.length) {
    body.push({
      id: "excluded",
      type: "list",
      ordinal: ordinal++,
      props: { heading: "Out of scope", variant: "exclusions", items: excluded.map((p) => p.item_name ?? p.task_ref) },
    });
  }
  body.push({ id: "signature", type: "signature", ordinal: ordinal++, props: { heading: "Acceptance" } });
  return body;
}
