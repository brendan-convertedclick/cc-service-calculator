// What was actually CHARGED for a client's ad hoc work in a month (0164).
//
// Lisa, 2026-09-09: "so completed hours can be compared against what was
// actually charged — this exposes under-billing or overrun risk." A retainer
// has carried its fee beside its hours all along; ad hoc work never did, so the
// tab could say a client had eleven hours done and nothing whatever about what
// anyone was billed for them.
//
// NET, always. `amount_net_cents` is ex-VAT and `retainer_monthly_fee_cents` is
// too, so the two sit on one page honestly. The older `amount_cents` on the
// same rows is Xero's VAT-inclusive total and is deliberately not read here —
// mixing them would put every comparison 15% out with nothing on screen saying
// so.
//
// A month's total is what was ISSUED in it (`issued_on`), which matches how
// completed work is attributed to the month it closed. `due_date` would file
// INV-2599 — dated 1 September, due 30 October — under October.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface InvoiceDoc {
  id: string;
  number: string | null;
  reference: string | null;
  kind: "invoice" | "quote";
  netCents: number;
  issuedOn: string;
}

export interface ClientMonthBilling {
  /** Billed. */
  invoicedNetCents: number;
  /** Accepted and not yet invoiced — committed, so kept out of invoiced. */
  quotedNetCents: number;
  docs: InvoiceDoc[];
}

/** Keyed `${clientId}|${YYYY-MM}`. */
export type BillingByClientMonth = Map<string, ClientMonthBilling>;

export function billingKey(clientId: string, month: string): string {
  return `${clientId}|${month}`;
}

export function useAdhocInvoices(monthsBack = 6) {
  return useQuery({
    queryKey: ["adhoc_invoices", monthsBack],
    queryFn: async (): Promise<BillingByClientMonth> => {
      const since = new Date();
      since.setMonth(since.getMonth() - monthsBack);

      const { data, error } = await supabase
        .from("xero_invoices")
        .select("id, client_id, invoice_number, reference, kind, amount_net_cents, issued_on")
        // Only rows that carry the two things this comparison needs. The 1,191
        // mirrored Xero rows have neither — they predate both columns — so they
        // are excluded by the data rather than by a source filter, which also
        // means a future Xero sync that DOES populate them starts counting
        // without a code change.
        .not("issued_on", "is", null)
        .not("amount_net_cents", "is", null)
        .gte("issued_on", since.toISOString().slice(0, 10));
      if (error) throw error;

      const out: BillingByClientMonth = new Map();
      for (const r of (data ?? []) as Array<{
        id: string;
        client_id: string | null;
        invoice_number: string | null;
        reference: string | null;
        kind: string | null;
        amount_net_cents: number | null;
        issued_on: string;
      }>) {
        if (!r.client_id) continue;
        const key = billingKey(r.client_id, r.issued_on.slice(0, 7));
        const cur = out.get(key) ?? { invoicedNetCents: 0, quotedNetCents: 0, docs: [] };
        const net = Number(r.amount_net_cents ?? 0);
        const kind = r.kind === "quote" ? "quote" : "invoice";
        if (kind === "quote") cur.quotedNetCents += net;
        else cur.invoicedNetCents += net;
        cur.docs.push({
          id: r.id,
          number: r.invoice_number,
          reference: r.reference,
          kind,
          netCents: net,
          issuedOn: r.issued_on,
        });
        out.set(key, cur);
      }
      return out;
    },
  });
}

/** What an hour of this month's work was actually charged at, or null when
 *  there is nothing to divide. Quotes count: the work is being done against
 *  them, and leaving them out makes a quoted job look unbilled. */
export function impliedRateCents(
  billing: ClientMonthBilling | undefined,
  completedHours: number,
): number | null {
  if (!billing || completedHours <= 0) return null;
  const total = billing.invoicedNetCents + billing.quotedNetCents;
  if (total <= 0) return null;
  return Math.round(total / completedHours);
}
