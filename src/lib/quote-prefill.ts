// src/lib/quote-prefill.ts
//
// Pure seeding logic: confirmed Scope Receipt placements → quote editor lines.
// The receipt (brief_task_sow_placements) is where the operator confirms what
// is billable, at what quantity and price — so the quote builder seeds from it
// instead of re-deriving services from the scope prose. No React, no Supabase.

import {
  isBillablePlacement,
  type BriefTaskSowPlacement,
} from "@/types/sow-placements";
import { lineQty } from "@/lib/scope-receipt";

export type QuoteSeedLine = {
  service_id: string;
  qty: number;
  /**
   * Unit price carried over from the receipt when it differs from the
   * catalogue sell price (operator edited it inline). Null = catalogue price.
   */
  unit_price_override_cents: number | null;
};

export type QuoteSeedResult = {
  lines: QuoteSeedLine[];
  /** Names of billable lines that could not seed a quote line (no linked catalogue service). */
  skipped: string[];
};

/** Minimal catalogue projection: service id → sell price. */
export type SeedCatalogEntry = { id: string; sell_price_cents: number | null };

/**
 * Turn a brief's placements into quote seed lines.
 *
 * - Only `new_billable` placements are quoted (matching the receipt footer).
 * - Quote lines are keyed by service, so placements sharing a service merge:
 *   quantities sum, and the unit price is the money-preserving weighted unit.
 * - Billable placements with no (known) linked service can't become quote
 *   lines — they are reported in `skipped` so the UI can say so.
 */
export function placementsToQuoteSeed(
  placements: BriefTaskSowPlacement[],
  catalog: Map<string, SeedCatalogEntry>,
): QuoteSeedResult {
  type Acc = { qty: number; totalCents: number };
  const byService = new Map<string, Acc>();
  const skipped: string[] = [];

  for (const p of placements) {
    if (!isBillablePlacement(p)) continue;
    const svc = p.suggested_service_id ? catalog.get(p.suggested_service_id) : undefined;
    if (!svc) {
      skipped.push(p.item_name ?? p.task_ref);
      continue;
    }
    const qty = lineQty(p);
    // Same fallback chain the receipt renders: placement estimate, else catalogue.
    const unitCents = p.estimated_cents ?? svc.sell_price_cents ?? 0;
    const acc = byService.get(svc.id) ?? { qty: 0, totalCents: 0 };
    acc.qty += qty;
    acc.totalCents += Math.round(qty * unitCents);
    byService.set(svc.id, acc);
  }

  const lines: QuoteSeedLine[] = [];
  for (const [service_id, acc] of byService) {
    const qty = Math.max(0.25, acc.qty);
    const unitCents = acc.qty > 0 ? Math.round(acc.totalCents / acc.qty) : 0;
    const catalogCents = catalog.get(service_id)?.sell_price_cents ?? 0;
    lines.push({
      service_id,
      qty,
      unit_price_override_cents: unitCents === catalogCents ? null : unitCents,
    });
  }

  return { lines, skipped };
}
