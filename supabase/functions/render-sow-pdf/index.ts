// supabase/functions/render-sow-pdf/index.ts
//
// Request:  POST { quote_id: string }
// Response: 200 { url: string }  -- signed Supabase Storage URL (90-day TTL)
//
// Loads the quote + scope + client, renders the HTML SOW into a PDF via
// @react-pdf/renderer, uploads the bytes to the quote-pdfs bucket, returns
// a 90-day signed URL. The HTML-to-PDF mapper supports h1/h2/h3/p/ul/li
// (the same subset draft-sow is prompted to produce).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import React from "npm:react@18.3.1";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "npm:@react-pdf/renderer@3";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 20, marginBottom: 10 },
  h2: { fontSize: 14, marginTop: 12, marginBottom: 6 },
  h3: { fontSize: 11, marginTop: 8, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  p: { marginBottom: 6, lineHeight: 1.4 },
  li: { marginLeft: 12, marginBottom: 3 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  footer: { marginTop: 20, fontSize: 8, color: "#555" },
});

/**
 * Minimal HTML → react-pdf mapper.
 * Supported tags: h1, h2, h3, p, ul, li. Unknown tags emit their text as <p>.
 * Attributes are ignored. Nested lists are flattened.
 */
function htmlToElements(html: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Tokenise by tag boundaries.
  const tokens = html.matchAll(/<(\/?[a-z0-9]+)[^>]*>([^<]*)/gi);
  let idx = 0;
  for (const m of tokens) {
    const tag = m[1].toLowerCase();
    const text = (m[2] ?? "").replace(/\s+/g, " ").trim();
    if (tag === "h1") {
      if (text) out.push(React.createElement(Text, { key: idx++, style: styles.h1 }, text));
    } else if (tag === "h2") {
      if (text) out.push(React.createElement(Text, { key: idx++, style: styles.h2 }, text));
    } else if (tag === "h3") {
      if (text) out.push(React.createElement(Text, { key: idx++, style: styles.h3 }, text));
    } else if (tag === "p") {
      if (text) out.push(React.createElement(Text, { key: idx++, style: styles.p }, text));
    } else if (tag === "li") {
      if (text) out.push(React.createElement(Text, { key: idx++, style: styles.li }, `• ${text}`));
    } else if (tag === "ul" || tag === "/ul" || tag === "/li" || tag === "/p") {
      // structural closers — nothing to emit
    } else if (text) {
      out.push(React.createElement(Text, { key: idx++, style: styles.p }, text));
    }
  }
  return out;
}

function fmtZar(cents: number | string | null): string {
  const n = Number(cents ?? 0) / 100;
  return n.toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { quote_id } = await req.json();
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const { data: quote, error } = await supabase
      .from("quotes")
      .select("*, scope:scopes(*, brief:briefs(*, client:clients(*)))")
      .eq("id", quote_id).single();
    if (error || !quote) return json({ error: error?.message ?? "Not found" }, 404);

    const client =
      (quote as { scope: { brief: { client: { name: string } | null } | null } })
        .scope.brief?.client ?? null;

    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: styles.page },
        React.createElement(
          View,
          { style: styles.row },
          React.createElement(Text, { style: styles.h1 }, "Statement of Work"),
          React.createElement(Text, null, `v${quote.version}`),
        ),
        React.createElement(Text, { style: styles.p }, `Client: ${client?.name ?? "Client"}`),
        ...htmlToElements(quote.sow_html ?? ""),
        React.createElement(Text, { style: styles.h2 }, "Pricing Summary"),
        React.createElement(
          Text,
          { style: styles.p },
          `Subtotal: ${fmtZar(quote.subtotal_cents)}`,
        ),
        React.createElement(
          Text,
          { style: styles.p },
          `Total: ${fmtZar(quote.total_cents)}`,
        ),
        React.createElement(
          Text,
          { style: styles.footer },
          "Converted Click · convertedclick.co.za",
        ),
      ),
    );

    const buf = await renderToBuffer(doc);
    const path = `${quote_id}/sow-v${quote.version}.pdf`;
    const { error: upErr } = await supabase.storage.from("quote-pdfs").upload(path, buf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: signed, error: signErr } = await supabase.storage
      .from("quote-pdfs").createSignedUrl(path, 60 * 60 * 24 * 90);
    if (signErr || !signed) return json({ error: signErr?.message ?? "sign failed" }, 500);

    return json({ url: signed.signedUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}
