// src/lib/scope-receipt.ts
//
// Pure view model for the Scope Receipt rail. Turns raw
// brief_task_sow_placements (+ the service catalog) into a three-bucket result
// shape the UI renders. No React, no Supabase — so totals and grouping are
// trivially testable and a per-line In/New/Out override re-buckets a row by
// swapping its disposition in the input map, with no server round-trip.

import {
  placementDisposition,
  type BriefTaskSowPlacement,
  type Disposition,
} from "@/types/sow-placements";

/** Fixed render order for the three bands. */
export const DISPOSITION_ORDER: Disposition[] = [
  "in_agreed_scope",
  "new_billable",
  "out_of_scope",
];

/** Visual tone keyed off disposition — maps to existing Badge variants. */
export type BucketTone = "included" | "billable" | "out";

export const TONE_BY_DISPOSITION: Record<Disposition, BucketTone> = {
  in_agreed_scope: "included",
  new_billable: "billable",
  out_of_scope: "out",
};

export const BAND_TITLE: Record<Disposition, string> = {
  in_agreed_scope: "Included — already paid for",
  new_billable: "New billable — quote",
  out_of_scope: "Out of scope — not offered",
};

/** Minimal catalog projection the receipt needs per matched service. */
export interface ReceiptCatalogService {
  id: string;
  code: string | null;
  name: string;
  sell_price_cents: number;
  unit_of_sale: string | null;
}

/** One line in the receipt, derived from a placement. */
export interface ReceiptLine {
  /** Stable key — the placement's task_ref. */
  taskRef: string;
  name: string;
  description: string | null;
  /** Catalog id of the linked service, or null when the line has none — a
   * billable line without one cannot become a quote line. */
  serviceId: string | null;
  /** Xero catalog code of the matched service, if any. */
  code: string | null;
  /** Unit of sale label (e.g. "per page"), if known. */
  unit: string | null;
  /** Positive finite quantity; falls back to 1. */
  qty: number;
  /** Per-unit sell price in cents (0 when unknown). */
  unitCents: number;
  /** qty * unitCents. */
  lineCents: number;
  /** 0–1 LLM confidence, or null. */
  confidence: number | null;
  /** Verbatim grounding quote from the inbound request, if captured. */
  groundingQuote: string | null;
  /** Whether the deterministic resolver flagged this line for human review. */
  needsReview: boolean;
  /** The bucket this line currently sits in (after any local override). */
  disposition: Disposition;
  /** Client-safe "why this bucket" — intake prose or the resolver template. */
  clientReason: string | null;
  /** Likely-assumed adjacent work intake flagged (not an explicit ask). */
  isAssumed: boolean;
  /**
   * Operator unticked this line. It stays visible (dimmed) in operator view so
   * it can be re-ticked, but contributes nothing to subtotals/counts and is
   * omitted from client view and the CE PDF.
   */
  excluded: boolean;
}

export interface ReceiptBucket {
  disposition: Disposition;
  tone: BucketTone;
  title: string;
  lines: ReceiptLine[];
  /** Sum of lineCents for the bucket. */
  subtotalCents: number;
}

export interface ScopeReceiptModel {
  /** Buckets in fixed DISPOSITION_ORDER (always all three, possibly empty). */
  buckets: ReceiptBucket[];
  /** Grand total = sum of new_billable lines only. */
  billableTotalCents: number;
  /** Per-bucket line counts, for the coverage bar + caption. */
  counts: Record<Disposition, number>;
  totalLines: number;
}

/** Coerce a placement's stored quantity to a positive finite number, else 1. */
export function lineQty(p: BriefTaskSowPlacement): number {
  return typeof p.quantity === "number" &&
    Number.isFinite(p.quantity) &&
    p.quantity > 0
    ? p.quantity
    : 1;
}

/**
 * Build the receipt model.
 *
 * @param placements    raw rows for the brief
 * @param serviceById   catalog keyed by service id (suggested_service_id)
 * @param overrides     optional local disposition overrides keyed by task_ref —
 *                      lets the per-line In/New/Out tabs re-bucket without a
 *                      server write while keeping this function pure.
 */
export function buildScopeReceipt(
  placements: BriefTaskSowPlacement[],
  serviceById: Map<string, ReceiptCatalogService>,
  overrides: Record<string, Disposition> = {},
): ScopeReceiptModel {
  const byDisposition: Record<Disposition, ReceiptLine[]> = {
    in_agreed_scope: [],
    new_billable: [],
    out_of_scope: [],
  };

  for (const p of placements) {
    const svc = p.suggested_service_id
      ? serviceById.get(p.suggested_service_id)
      : undefined;
    const qty = lineQty(p);
    // Prefer the placement's own estimate; fall back to the catalog sell price.
    const unitCents = p.estimated_cents ?? svc?.sell_price_cents ?? 0;
    const disposition = overrides[p.task_ref] ?? placementDisposition(p);

    const line: ReceiptLine = {
      taskRef: p.task_ref,
      name: p.item_name ?? p.task_ref,
      description: p.item_description,
      serviceId: svc?.id ?? null,
      code: svc?.code ?? null,
      unit: svc?.unit_of_sale ?? null,
      qty,
      unitCents,
      lineCents: Math.round(qty * unitCents),
      confidence: p.ai_confidence,
      groundingQuote: p.grounding_quote ?? p.ai_match_quote,
      needsReview: p.needs_review === true,
      disposition,
      clientReason: p.client_reason ?? null,
      isAssumed: p.is_assumed === true,
      excluded: p.excluded === true,
    };
    byDisposition[disposition].push(line);
  }

  // Excluded (unticked) lines stay in their bucket for the operator to
  // re-tick, but never count or total — they're already "not happening".
  const active = (lines: ReceiptLine[]) => lines.filter((l) => !l.excluded);

  const buckets: ReceiptBucket[] = DISPOSITION_ORDER.map((d) => {
    const lines = byDisposition[d];
    const subtotalCents = active(lines).reduce((s, l) => s + l.lineCents, 0);
    return {
      disposition: d,
      tone: TONE_BY_DISPOSITION[d],
      title: BAND_TITLE[d],
      lines,
      subtotalCents,
    };
  });

  const counts: Record<Disposition, number> = {
    in_agreed_scope: active(byDisposition.in_agreed_scope).length,
    new_billable: active(byDisposition.new_billable).length,
    out_of_scope: active(byDisposition.out_of_scope).length,
  };

  return {
    buckets,
    billableTotalCents: active(byDisposition.new_billable).reduce(
      (s, l) => s + l.lineCents,
      0,
    ),
    counts,
    totalLines: placements.filter((p) => p.excluded !== true).length,
  };
}

/** Bucketed confidence tier used to colour the ConfidenceChip. */
export type ConfidenceTier = "high" | "med" | "low";

export function confidenceTier(confidence: number | null): ConfidenceTier | null {
  if (confidence === null || !Number.isFinite(confidence)) return null;
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "med";
  return "low";
}
