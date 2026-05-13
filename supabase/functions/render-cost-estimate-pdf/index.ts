// supabase/functions/render-cost-estimate-pdf/index.ts
//
// Request:  POST { quote_id: string }
// Response: 200 { url: string }  -- signed Supabase Storage URL (90-day TTL)
//
// Renders a client-facing Cost Estimate PDF: service name + qty + line total
// per quote line, plus subtotal / VAT (15%) / total inc. VAT. Aggregates
// quote_line_item_allocations by ordinal to produce one row per line.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import React from "npm:react@18.3.1";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "npm:@react-pdf/renderer@3";

const VAT_RATE = 0.15;

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1f1f1f" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  meta: { fontSize: 9, color: "#555", textAlign: "right" },
  clientBlock: { marginBottom: 18 },
  clientLabel: { fontSize: 8, color: "#777", textTransform: "uppercase", letterSpacing: 1 },
  clientName: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1f1f1f",
    paddingBottom: 4,
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
  },
  colService: { width: 375, paddingRight: 8 },
  colQty: { width: 50, textAlign: "right", paddingRight: 8 },
  colTotal: { width: 90, textAlign: "right" },
  totalsBlock: { marginTop: 14, alignSelf: "flex-end", width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { color: "#555" },
  totalsValue: { fontFamily: "Helvetica-Bold" },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#1f1f1f",
  },
  grandLabel: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  grandValue: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#777", textAlign: "center" },
});

function fmtZar(cents: number): string {
  const n = cents / 100;
  return n.toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
}

type AllocRow = {
  ordinal: number;
  service_name: string;
  qty: number | string;
  subtotal_cents: number | string;
};

type LineRow = { ordinal: number; service_name: string; qty: number; line_cents: number };

function aggregateLines(rows: AllocRow[]): LineRow[] {
  const byOrdinal = new Map<number, LineRow>();
  for (const r of rows) {
    const existing = byOrdinal.get(r.ordinal);
    const cents = Number(r.subtotal_cents);
    if (existing) {
      existing.line_cents += cents;
    } else {
      byOrdinal.set(r.ordinal, {
        ordinal: r.ordinal,
        service_name: r.service_name,
        qty: Number(r.qty),
        line_cents: cents,
      });
    }
  }
  return [...byOrdinal.values()].sort((a, b) => a.ordinal - b.ordinal);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { quote_id } = await req.json();
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const supabase = createServiceRoleClient();

    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .select("id, version, subtotal_cents, total_cents, scope_id")
      .eq("id", quote_id)
      .single();
    if (qErr || !quote) return json({ error: qErr?.message ?? "Quote not found" }, 404);

    let clientName = "Client";
    const { data: scopeRow } = await supabase
      .from("scopes")
      .select("brief:briefs(client:clients(name))")
      .eq("id", quote.scope_id)
      .single();
    const brief = (scopeRow as { brief: { client: { name: string } | null } | null } | null)?.brief;
    if (brief?.client?.name) clientName = brief.client.name;

    const { data: allocs, error: aErr } = await supabase
      .from("quote_line_item_allocations")
      .select("ordinal, service_name, qty, subtotal_cents")
      .eq("quote_id", quote_id);
    if (aErr) return json({ error: aErr.message }, 500);

    const lines = aggregateLines((allocs ?? []) as AllocRow[]);
    const subtotal = Number(quote.total_cents);
    const vat = Math.round(subtotal * VAT_RATE);
    const grand = subtotal + vat;

    const today = new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });

    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: styles.page },
        React.createElement(
          View,
          { style: styles.header },
          React.createElement(Text, { style: styles.title }, "Cost Estimate"),
          React.createElement(
            View,
            null,
            React.createElement(Text, { style: styles.meta }, `Version ${quote.version}`),
            React.createElement(Text, { style: styles.meta }, today),
          ),
        ),
        React.createElement(
          View,
          { style: styles.clientBlock },
          React.createElement(Text, { style: styles.clientLabel }, "Prepared for"),
          React.createElement(Text, { style: styles.clientName }, clientName),
        ),
        React.createElement(
          View,
          { style: styles.tableHead },
          React.createElement(Text, { style: styles.colService }, "Service"),
          React.createElement(Text, { style: styles.colQty }, "Qty"),
          React.createElement(Text, { style: styles.colTotal }, "Line total"),
        ),
        ...lines.map((l) =>
          React.createElement(
            View,
            { key: l.ordinal, style: styles.row },
            React.createElement(Text, { style: styles.colService }, l.service_name),
            React.createElement(Text, { style: styles.colQty }, String(l.qty)),
            React.createElement(Text, { style: styles.colTotal }, fmtZar(l.line_cents)),
          ),
        ),
        React.createElement(
          View,
          { style: styles.totalsBlock },
          React.createElement(
            View,
            { style: styles.totalsRow },
            React.createElement(Text, { style: styles.totalsLabel }, "Subtotal"),
            React.createElement(Text, { style: styles.totalsValue }, fmtZar(subtotal)),
          ),
          React.createElement(
            View,
            { style: styles.totalsRow },
            React.createElement(Text, { style: styles.totalsLabel }, "VAT (15%)"),
            React.createElement(Text, { style: styles.totalsValue }, fmtZar(vat)),
          ),
          React.createElement(
            View,
            { style: styles.grandRow },
            React.createElement(Text, { style: styles.grandLabel }, "Total inc. VAT"),
            React.createElement(Text, { style: styles.grandValue }, fmtZar(grand)),
          ),
        ),
        React.createElement(
          Text,
          { style: styles.footer },
          "Converted Click · convertedclick.co.za · Estimate valid for 30 days · Subject to signed SOW",
        ),
      ),
    );

    const buf = await renderToBuffer(doc);
    const path = `${quote_id}/cost-estimate-v${quote.version}.pdf`;
    const { error: upErr } = await supabase.storage.from("quote-pdfs").upload(path, buf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: signed, error: signErr } = await supabase.storage
      .from("quote-pdfs")
      .createSignedUrl(path, 60 * 60 * 24 * 90);
    if (signErr || !signed) return json({ error: signErr?.message ?? "sign failed" }, 500);

    return json({ url: signed.signedUrl });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error("render-cost-estimate-pdf failed:", msg);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
