// supabase/functions/suggest-services/index.ts
//
// Request:  POST { brief_id: string }
// Response: 200 { suggestions: Array<{ service_id, qty, confidence, reasoning }> }
//
// Loads brief + locked scope + active services catalogue, prompts Claude for
// up to 8 ranked service matches. Filters the response against known
// service_ids. Never auto-adds to quotes — caller shows a modal.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);
    const { brief_id } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const [{ data: settings }, { data: brief }, { data: scope }, { data: services }] = await Promise.all([
      supabase.from("settings").select("anthropic_model").eq("id", 1).single(),
      supabase.from("briefs").select("*").eq("id", brief_id).single(),
      supabase.from("scopes").select("*").eq("brief_id", brief_id).single(),
      supabase.from("services").select("id,name,code,scope_definition").eq("status", "active"),
    ]);
    if (!brief || !scope) return json({ error: "Brief or scope missing" }, 404);

    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";
    const catalogue = (services ?? [])
      .map((s) =>
        `  ${s.id} [${s.code ?? "-"}] ${s.name}${s.scope_definition ? ` — ${s.scope_definition.slice(0, 180)}` : ""}`,
      )
      .join("\n");

    const system = [
      "You are a scoping assistant at Converted Click. Given a locked scope and a full service catalogue,",
      "propose up to 8 services that should be on the quote, with quantity and confidence (0-1).",
      'Return JSON only: {"suggestions":[{"service_id":"","qty":0,"confidence":0,"reasoning":""}]}.',
      "Only use service_ids from the catalogue below. Do not invent services.",
      "",
      "Catalogue:",
      catalogue,
    ].join("\n");

    const user = [
      `Subject: ${brief.raw_subject ?? "(none)"}`,
      "",
      "Clarified scope:",
      scope.enhanced_prose ?? "",
      "",
      "In scope:",
      scope.in_scope_md ?? "",
      "",
      "Out of scope:",
      scope.out_of_scope_md ?? "",
    ].join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return json({ error: `Anthropic: ${await res.text()}` }, 502);

    const body = await res.json();
    const text: string = body.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "AI did not return JSON", raw: text }, 502);

    const parsed = JSON.parse(match[0]);
    const knownIds = new Set((services ?? []).map((s: { id: string }) => s.id));
    const suggestions = (parsed.suggestions ?? [])
      .filter((s: { service_id?: string }) => s.service_id && knownIds.has(s.service_id))
      .map((s: { service_id: string; qty?: number; confidence?: number; reasoning?: string }) => ({
        service_id: s.service_id,
        qty: Math.max(0.25, Number(s.qty ?? 1)),
        confidence: Math.max(0, Math.min(1, Number(s.confidence ?? 0))),
        reasoning: String(s.reasoning ?? "").slice(0, 500),
      }));

    return json({ suggestions });
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
    "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  };
}
