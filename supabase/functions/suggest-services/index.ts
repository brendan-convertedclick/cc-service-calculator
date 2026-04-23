// supabase/functions/suggest-services/index.ts
//
// Request:  POST { brief_id: string }
// Response: 200 { suggestions: Array<{ service_id, qty, confidence, reasoning }> }
//
// Loads brief + locked scope + active services catalogue, prompts Claude for
// up to 8 ranked service matches. Filters the response against known
// service_ids. Never auto-adds to quotes — caller shows a modal.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { brief_id } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createUserClient(req);

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

    const body = await callAnthropic({
      model,
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 2048,
      cacheSystem: true,
    });

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
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("Anthropic ")) return json({ error: msg }, 502);
    return json({ error: msg }, 500);
  }
});
