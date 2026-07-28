/**
 * Quote aggregation + line-item snapshot. Pure, no I/O.
 *
 * Used by ProjectBuilder for live totals and by Finalise-quote to freeze
 * catalogue state into the quote_line_item_allocations snapshot table so
 * later catalogue edits don't retroactively change accepted quotes.
 */

export type DeptRef = { id: string; name: string; hourly_rate_cents: number; xero_code: string | null };

export type QuoteLineAllocation = { dept_id: string; pct: number };

export type QuoteLine = {
  service_id: string;
  service_name: string;
  qty: number;
  unit_price_cents: number;
  allocation: QuoteLineAllocation[];
};

export type SnapshotAllocation = {
  dept_id: string;
  dept_name: string;
  xero_code: string | null;
  hours: number;
  cost_share_cents: number;
};

export type SnapshotLineItem = {
  service_id: string;
  service_name: string;
  qty: number;
  unit_price_cents: number;
  subtotal_cents: number;
  allocation: SnapshotAllocation[];
};

export function aggregateTotals(
  lines: QuoteLine[],
  opts: { margin_pct: number; discount_room_pct: number },
): { subtotal_cents: number; total_cents: number } {
  const subtotal_cents = lines.reduce(
    (acc, l) => acc + Math.round(l.unit_price_cents * l.qty),
    0,
  );
  const afterMargin = Math.round(subtotal_cents * (1 + opts.margin_pct / 100));
  const total_cents = Math.round(afterMargin * (1 - opts.discount_room_pct / 100));
  return { subtotal_cents, total_cents };
}

export function buildLineItems(lines: QuoteLine[], depts: DeptRef[]): SnapshotLineItem[] {
  const deptMap = new Map(depts.map((d) => [d.id, d]));
  return lines.map((l) => {
    const subtotal_cents = Math.round(l.unit_price_cents * l.qty);
    const allocation = l.allocation.map((a) => {
      const d = deptMap.get(a.dept_id);
      const cost_share_cents = Math.round((subtotal_cents * a.pct) / 100);
      const rate = d?.hourly_rate_cents ?? 0;
      const hours = rate > 0 ? round2(cost_share_cents / rate) : 0;
      return {
        dept_id: a.dept_id,
        dept_name: d?.name ?? "Unknown",
        xero_code: d?.xero_code ?? null,
        hours,
        cost_share_cents,
      };
    });
    return {
      service_id: l.service_id,
      service_name: l.service_name,
      qty: l.qty,
      unit_price_cents: l.unit_price_cents,
      subtotal_cents,
      allocation,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
