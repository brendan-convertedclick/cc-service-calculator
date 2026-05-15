// src/pages/LiveTasksInvoicePreview.tsx
//
// Live-task invoice preview. Operator picks a client + period; we hit
// build-live-invoice and render the resulting Xero-shaped line items.
// Preview only — no push to Xero from here yet.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Line = { description: string; quantity: number; unit_amount_cents: number; amount_cents: number };
type Preview = { lines: Line[]; total_cents: number; warnings: string[] };

const ZAR = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const fmt = (cents: number) => ZAR.format(cents / 100);

function toLocalDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function LiveTasksInvoicePreview() {
  const today = new Date();
  const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const [clientId, setClientId] = useState<string>("");
  const [periodStart, setPeriodStart] = useState(toLocalDateString(firstOfLastMonth));
  const [periodEnd, setPeriodEnd] = useState(toLocalDateString(firstOfThisMonth));

  const { data: clients } = useQuery({
    queryKey: ["clients-for-invoice"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, short_name")
        .is("archived_at", null)
        .order("short_name");
      if (error) throw error;
      return data;
    },
  });

  const preview = useQuery<Preview>({
    queryKey: ["live-invoice-preview", clientId, periodStart, periodEnd],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("build-live-invoice", {
        body: { client_id: clientId, period_start: periodStart, period_end: periodEnd },
      });
      if (error) throw error;
      return data as Preview;
    },
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-headline-medium">Live tasks — invoice preview</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-label-small">Client</label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {(clients ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.short_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-label-small">Period start</label>
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-label-small">Period end (exclusive)</label>
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <Button onClick={() => preview.refetch()} disabled={!clientId}>Refresh</Button>
      </div>

      {preview.isLoading && <p className="text-body-small text-m-on-surface-variant">Computing…</p>}
      {preview.error && <p className="text-body-small text-destructive">{(preview.error as Error).message}</p>}

      {preview.data && (
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container">
          <table className="w-full text-body-small">
            <thead className="text-label-small text-m-on-surface-variant">
              <tr>
                <th className="text-left p-3">Description</th>
                <th className="text-right p-3">Hours</th>
                <th className="text-right p-3">Rate</th>
                <th className="text-right p-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {preview.data.lines.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-m-on-surface-variant">No billable hours in this period.</td></tr>
              )}
              {preview.data.lines.map((l, i) => (
                <tr key={i} className="border-t border-m-outline-variant">
                  <td className="p-3">{l.description}</td>
                  <td className="p-3 text-right">{l.quantity.toFixed(2)}</td>
                  <td className="p-3 text-right">{fmt(l.unit_amount_cents)}</td>
                  <td className="p-3 text-right">{fmt(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-title-small">
              <tr className="border-t border-m-outline-variant">
                <td className="p-3" colSpan={3}>Total</td>
                <td className="p-3 text-right">{fmt(preview.data.total_cents)}</td>
              </tr>
            </tfoot>
          </table>
          {preview.data.warnings.length > 0 && (
            <ul className="p-3 text-body-small text-destructive space-y-1">
              {preview.data.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
