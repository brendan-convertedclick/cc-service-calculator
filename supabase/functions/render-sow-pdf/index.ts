// supabase/functions/render-sow-pdf/index.ts — SPIKE
//
// Purpose: prove @react-pdf/renderer works inside a Supabase Deno Edge
// Function. Not the final implementation. Real version (Task 30 in the plan)
// loads a quote, renders the HTML content, uploads to Storage, returns a
// signed URL.
//
// Contract for this spike:
//   Request:  POST { title?: string }
//   Response: 200 application/pdf bytes
//
// Accepts anon auth (no JWT verification required for the spike; deploy with
// --no-verify-jwt).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import React from "npm:react@18.3.1";
import { Document, Page, Text, renderToBuffer } from "npm:@react-pdf/renderer@3";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { title = "Spike" } = await req.json().catch(() => ({}));
    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4" },
        React.createElement(Text, null, `Hello from ${title}`),
      ),
    );
    const buf = await renderToBuffer(doc);
    return new Response(buf, {
      status: 200,
      headers: { "content-type": "application/pdf", ...cors() },
    });
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
