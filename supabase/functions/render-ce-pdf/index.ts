// supabase/functions/render-ce-pdf/index.ts
//
// Request:  POST { change_estimate_id: string }
// Response: 200 { url: string }  -- signed Supabase Storage URL (90-day TTL)
//
// Renders a client-facing Cost Estimate PDF for a change_estimate (the brief
// flow's Stage 4): description + qty + line total per line item, plus
// subtotal / VAT (15%) / total inc. VAT. Mirrors render-cost-estimate-pdf
// (which renders quotes) and stores the signed URL on change_estimates.pdf_url.

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
  clientBlock: { marginBottom: 8 },
  clientLabel: { fontSize: 8, color: "#777", textTransform: "uppercase", letterSpacing: 1 },
  clientName: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  summary: { marginBottom: 16, color: "#444", lineHeight: 1.4 },
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
  itemDetail: { marginTop: 2, fontSize: 8.5, color: "#666", lineHeight: 1.35 },
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

type CELine = {
  description: string | null;
  detail: string | null;
  qty: number | string;
  unit_value_cents: number | string;
  sort_order: number | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { change_estimate_id } = await req.json();
    if (!change_estimate_id) return json({ error: "change_estimate_id required" }, 400);

    const supabase = createServiceRoleClient();

    const { data: ce, error: ceErr } = await supabase
      .from("change_estimates")
      .select("id, summary, reason, delta_value_cents, client:clients(name), brief:briefs(raw_subject)")
      .eq("id", change_estimate_id)
      .single();
    if (ceErr || !ce) return json({ error: ceErr?.message ?? "Change estimate not found" }, 404);

    const clientName =
      (ce as { client?: { name?: string } | null }).client?.name ?? "Client";
    const briefSubject =
      (ce as { brief?: { raw_subject?: string | null } | null }).brief?.raw_subject ?? null;

    const { data: lineRows, error: lErr } = await supabase
      .from("change_estimate_line_items")
      .select("description, detail, qty, unit_value_cents, sort_order")
      .eq("change_estimate_id", change_estimate_id)
      .order("sort_order");
    if (lErr) return json({ error: lErr.message }, 500);

    const lines = ((lineRows ?? []) as CELine[]).map((l, i) => {
      const qty = Number(l.qty) || 1;
      const unit = Number(l.unit_value_cents) || 0;
      return {
        key: i,
        description: l.description?.trim() || "Line item",
        detail: l.detail?.trim() || null,
        qty,
        line_cents: Math.round(qty * unit),
      };
    });

    const subtotal = lines.reduce((s, l) => s + l.line_cents, 0);
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
            briefSubject
              ? React.createElement(Text, { style: styles.meta }, briefSubject)
              : null,
            React.createElement(Text, { style: styles.meta }, today),
          ),
        ),
        React.createElement(
          View,
          { style: styles.clientBlock },
          React.createElement(Text, { style: styles.clientLabel }, "Prepared for"),
          React.createElement(Text, { style: styles.clientName }, clientName),
        ),
        ce.summary
          ? React.createElement(Text, { style: styles.summary }, ce.summary as string)
          : null,
        React.createElement(
          View,
          { style: styles.tableHead },
          React.createElement(Text, { style: styles.colService }, "Item"),
          React.createElement(Text, { style: styles.colQty }, "Qty"),
          React.createElement(Text, { style: styles.colTotal }, "Line total"),
        ),
        ...lines.map((l) =>
          React.createElement(
            View,
            { key: l.key, style: styles.row },
            React.createElement(
              View,
              { style: styles.colService },
              React.createElement(Text, null, l.description),
              l.detail
                ? React.createElement(Text, { style: styles.itemDetail }, l.detail)
                : null,
            ),
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
    const path = `ce/${change_estimate_id}/cost-estimate.pdf`;
    const { error: upErr } = await supabase.storage.from("quote-pdfs").upload(path, buf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: signed, error: signErr } = await supabase.storage
      .from("quote-pdfs")
      .createSignedUrl(path, 60 * 60 * 24 * 90);
    if (signErr || !signed) return json({ error: signErr?.message ?? "sign failed" }, 500);

    const { error: updErr } = await supabase
      .from("change_estimates")
      .update({ pdf_url: signed.signedUrl, updated_at: new Date().toISOString() })
      .eq("id", change_estimate_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ url: signed.signedUrl });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error("render-ce-pdf failed:", msg);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
