// supabase/functions/draft-scope/index.ts
//
// Request:  POST { brief_id: string; nudge?: string }
// Response: 200 { scope: { enhanced_prose, in_scope_md, out_of_scope_md, open_questions_md } }
//
// Loads the brief + client, calls Anthropic for a structured JSON draft,
// upserts the scopes row with ai_drafted=true, returns the draft.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);
    const { brief_id, nudge } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const [{ data: settings }, { data: brief, error: bErr }] = await Promise.all([
      supabase.from("settings").select("anthropic_model").eq("id", 1).single(),
      supabase.from("briefs").select("*, client:clients(name)").eq("id", brief_id).single(),
    ]);
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";

    const system = [
      "You are a digital agency scoping analyst at Converted Click.",
      "A client sent a request. Rewrite it as:",
      "1) enhanced_prose — one-paragraph clarified summary",
      "2) in_scope — bullet list of explicit in-scope items",
      "3) out_of_scope — bullet list of likely out-of-scope items to confirm exclusion",
      "4) open_questions — bullet list of questions to ask before quoting",
      'Return JSON only: {"enhanced_prose":"","in_scope":[],"out_of_scope":[],"open_questions":[]}.',
      "Do not invent services or commitments.",
    ].join("\n");

    const clientName = (brief as { client?: { name: string } | null }).client?.name;
    const user = [
      clientName ? `Client: ${clientName}` : null,
      `Subject: ${brief.raw_subject ?? "(none)"}`,
      "",
      "Body:",
      brief.raw_body,
      nudge ? `\n\nAdditional guidance from staff: ${nudge}` : null,
    ].filter(Boolean).join("\n");

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
    const scope = {
      enhanced_prose: String(parsed.enhanced_prose ?? ""),
      in_scope_md: (parsed.in_scope ?? []).map((s: string) => `- ${s}`).join("\n"),
      out_of_scope_md: (parsed.out_of_scope ?? []).map((s: string) => `- ${s}`).join("\n"),
      open_questions_md: (parsed.open_questions ?? []).map((s: string) => `- ${s}`).join("\n"),
    };

    await supabase
      .from("scopes")
      .upsert(
        { brief_id, ...scope, ai_drafted: true, updated_at: new Date().toISOString() },
        { onConflict: "brief_id" },
      );

    return json({ scope });
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
