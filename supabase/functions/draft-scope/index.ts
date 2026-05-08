// supabase/functions/draft-scope/index.ts
//
// Request:  POST { brief_id: string; nudge?: string }
// Response: 200 { scope: { enhanced_prose, in_scope_md, out_of_scope_md, open_questions_md } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";
import { loadClientWikiContext } from "../_shared/wiki-context.ts";

const WIKI_REPO = Deno.env.get("WIKI_GITHUB_REPO") ?? "";
const WIKI_PAT  = Deno.env.get("WIKI_GITHUB_PAT")  ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { brief_id, nudge } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createUserClient(req);

    const [{ data: settings }, { data: brief, error: bErr }] = await Promise.all([
      supabase.from("settings").select("anthropic_model").eq("id", 1).single(),
      supabase
        .from("briefs")
        .select("*, client:clients(id, name, wiki_path)")
        .eq("id", brief_id)
        .single(),
    ]);
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";
    const client = (brief as { client?: { id: string; name: string; wiki_path: string | null } | null }).client;

    // Best-effort wiki context — never fails the brief if unavailable
    let wikiContext = "";
    if (client?.wiki_path && WIKI_REPO && WIKI_PAT) {
      try {
        wikiContext = await loadClientWikiContext({
          clientName: client.name,
          wikiPath: client.wiki_path,
          repo: WIKI_REPO,
          pat: WIKI_PAT,
        });
      } catch (err) {
        console.warn(`[draft-scope] wiki context failed: ${err}`);
      }
    }

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

    const clientName = client?.name;
    const userParts = [
      clientName ? `Client: ${clientName}` : null,
      `Subject: ${brief.raw_subject ?? "(none)"}`,
      "",
      "Body:",
      brief.raw_body,
      nudge ? `\n\nAdditional guidance from staff: ${nudge}` : null,
      wikiContext ? `\n\n${wikiContext}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const body = await callAnthropic({
      model,
      system,
      messages: [{ role: "user", content: userParts }],
      maxTokens: 2048,
      cacheSystem: true,
    });

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
        {
          brief_id,
          ...scope,
          ai_drafted: true,
          ai_context_snapshot: wikiContext || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "brief_id" },
      );

    return json({ scope });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("Anthropic ")) return json({ error: msg }, 502);
    return json({ error: msg }, 500);
  }
});
