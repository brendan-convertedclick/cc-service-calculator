// supabase/functions/draft-sow/index.ts
//
// Request:  POST { quote_id: string }
// Response: 200 { sow_html: string }
//
// Loads quote + scope + brief + client + selected services, plus the master
// SoW templates from the public.master_sows table, and prompts Claude with
// them as reference. Returns an HTML SOW document scoped to the mapper
// supported by render-sow-pdf (h1/h2/h3/p/ul/li).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { quote_id } = await req.json();
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const supabase = createUserClient(req);

    const { data: settings } = await supabase
      .from("settings").select("anthropic_model").eq("id", 1).single();
    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .select("*, scope:scopes(*, brief:briefs(*, client:clients(*)))")
      .eq("id", quote_id).single();
    if (qErr || !quote) return json({ error: qErr?.message ?? "Quote not found" }, 404);

    const { data: qsvcs } = await supabase
      .from("quote_services").select("*, service:services(*)")
      .eq("quote_id", quote_id).order("ordinal");

    const { data: sows, error: sowsErr } = await supabase
      .from("master_sows")
      .select("title, body_md")
      .order("slug");
    if (sowsErr) return json({ error: sowsErr.message }, 500);

    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";

    const system = [
      "You are drafting a Statement of Work for Converted Click, a South African digital agency.",
      "Use the master SoW templates below as reference. Produce HTML, not Markdown.",
      "Sections, in order: Overview, Deliverables (one <h3> subsection per service), Exclusions, Terms, Pricing Summary.",
      "Use <h2> for section headings, <h3> for subsections, <p>, <ul>, <li>.",
      "Do NOT use <table>, <img>, <script>, <style>, or inline styles — the PDF mapper only supports the tags above.",
      "Do not invent scope commitments not present in the locked scope and selected services.",
      "",
      "Master SoW templates:",
      (sows ?? [])
        .map((s) => `--- ${s.title} ---\n${s.body_md.slice(0, 3000)}`)
        .join("\n\n"),
    ].join("\n");

    const scope = (quote as {
      scope: {
        enhanced_prose?: string;
        in_scope_md?: string;
        out_of_scope_md?: string;
        brief?: { raw_subject?: string; client?: { name?: string } | null } | null;
      };
    }).scope;

    const user = [
      `Client: ${scope.brief?.client?.name ?? "Client"}`,
      `Subject: ${scope.brief?.raw_subject ?? ""}`,
      "",
      "Scope:",
      scope.enhanced_prose ?? "",
      "",
      "In scope:",
      scope.in_scope_md ?? "",
      "",
      "Out of scope:",
      scope.out_of_scope_md ?? "",
      "",
      "Selected services:",
      (qsvcs ?? [])
        .map((q: { service: { name: string; code: string | null; scope_definition: string | null }; qty: number }) =>
          `- ${q.service.name} (qty ${q.qty})${q.service.scope_definition ? `: ${q.service.scope_definition.slice(0, 200)}` : ""}`,
        )
        .join("\n"),
    ].join("\n");

    const body = await callAnthropic({
      model,
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 4096,
      cacheSystem: true,
    });

    const sow_html: string = body.content?.[0]?.text ?? "";
    if (!sow_html) return json({ error: "AI returned empty content" }, 502);

    return json({ sow_html });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("Anthropic ")) return json({ error: msg }, 502);
    return json({ error: msg }, 500);
  }
});
