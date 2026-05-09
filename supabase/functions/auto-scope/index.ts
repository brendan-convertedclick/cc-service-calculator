// supabase/functions/auto-scope/index.ts
//
// Request:  POST { brief_id: string }
//   Authorization: Bearer <service_role_key>  (called internally by gmail-relay)
// Response: 200 { ok: true, intent_type: string }
//   - 404 if brief not found
//   - 500 on unexpected error (brief is never affected)
//
// Failure in this function is always logged and swallowed — it must never
// cause gmail-relay to fail or retry.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";
import { loadClientWikiContext, loadWikiFile } from "../_shared/wiki-context.ts";
import {
  type IntentType,
  parseQuickResponseRules,
  matchesQuickResponseRule,
  parseClassifyResponse,
  parseScopeJson,
  CLASSIFY_SYSTEM,
  buildClassifyUser,
  buildScopeSystem,
  buildScopeUser,
} from "../_shared/auto-scope-logic.ts";

const WIKI_REPO = Deno.env.get("WIKI_GITHUB_REPO") ?? "";
const WIKI_PAT  = Deno.env.get("WIKI_GITHUB_PAT")  ?? "";
const RULES_PATH = "cc-vault/wiki/config/quick-response-rules.md";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { brief_id } = await req.json();
    if (!brief_id) return json({ error: "brief_id required" }, 400);

    const supabase = createServiceRoleClient();

    // 1. Load brief + client
    const { data: brief, error: bErr } = await supabase
      .from("briefs")
      .select("*, client:clients(id, name, wiki_path)")
      .eq("id", brief_id)
      .single();

    if (bErr || !brief) {
      console.error(`[auto-scope] brief ${brief_id} not found`, bErr?.message);
      return json({ error: "not found" }, 404);
    }

    const client = (brief as { client?: { id: string; name: string; wiki_path: string | null } | null }).client;

    const [{ data: settings }] = await Promise.all([
      supabase.from("settings").select("anthropic_model").eq("id", 1).single(),
    ]);
    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";

    // 2. Load wiki context (best-effort — never throws)
    let wikiContext = "";
    let rulesMarkdown = "";

    if (WIKI_REPO && WIKI_PAT) {
      const [wikiResult, rulesResult] = await Promise.allSettled([
        client?.wiki_path
          ? loadClientWikiContext({
              clientName: client.name,
              wikiPath: client.wiki_path,
              repo: WIKI_REPO,
              pat: WIKI_PAT,
            })
          : Promise.resolve(""),
        loadWikiFile({ path: RULES_PATH, repo: WIKI_REPO, pat: WIKI_PAT }),
      ]);
      if (wikiResult.status === "fulfilled") wikiContext = wikiResult.value;
      if (rulesResult.status === "fulfilled") rulesMarkdown = rulesResult.value;
    }

    const subject = brief.raw_subject ?? "";
    const body = brief.raw_body ?? "";
    const clientName = client?.name ?? null;

    // 3. Rule pre-filter
    const rules = parseQuickResponseRules(rulesMarkdown);
    let intentType: IntentType;

    if (matchesQuickResponseRule(subject, body, rules)) {
      intentType = "quick_response";
    } else {
      // 4. Claude call 1 — classify
      try {
        const classifyBody = await callAnthropic({
          model,
          system: CLASSIFY_SYSTEM,
          messages: [{ role: "user", content: buildClassifyUser({ subject, body, clientName, wikiContext }) }],
          maxTokens: 256,
          cacheSystem: true,
        });
        const classifyText: string = classifyBody.content?.[0]?.text ?? "";
        intentType = parseClassifyResponse(classifyText);
      } catch (e) {
        console.error("[auto-scope] classify call failed:", e);
        // Leave intent_type null — UI shows pending state with manual fallback
        await supabase
          .from("briefs")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", brief_id);
        return json({ ok: false, error: "classify failed" }, 200);
      }
    }

    // 5. Claude call 2 — scope / respond
    let scopeData: Record<string, unknown> = {};
    try {
      const scopeBody = await callAnthropic({
        model,
        system: buildScopeSystem(intentType),
        messages: [{ role: "user", content: buildScopeUser({ subject, body, clientName, wikiContext }) }],
        maxTokens: 2048,
        cacheSystem: true,
      });
      const scopeText: string = scopeBody.content?.[0]?.text ?? "";
      scopeData = parseScopeJson(scopeText);
    } catch (e) {
      console.error("[auto-scope] scope call failed:", e);
      // Still write intent_type — the scope can be filled manually
    }

    // 6. Write to DB
    await supabase
      .from("briefs")
      .update({
        intent_type: intentType,
        draft_reply: intentType === "quick_response"
          ? (typeof scopeData.draft_reply === "string" ? scopeData.draft_reply : null)
          : null,
        status: "needs_review",
        updated_at: new Date().toISOString(),
      })
      .eq("id", brief_id);

    if (intentType !== "quick_response") {
      const toStrings = (v: unknown): string[] =>
        Array.isArray(v) ? (v as unknown[]).map(String) : [];

      await supabase
        .from("scopes")
        .upsert(
          {
            brief_id,
            scope_type: intentType,
            enhanced_prose: typeof scopeData.enhanced_prose === "string"
              ? scopeData.enhanced_prose
              : null,
            in_scope_md: toStrings(scopeData.in_scope).map((s) => `- ${s}`).join("\n") || null,
            out_of_scope_md: toStrings(scopeData.out_of_scope).map((s) => `- ${s}`).join("\n") || null,
            open_questions_md: toStrings(scopeData.open_questions).map((s) => `- ${s}`).join("\n") || null,
            ai_drafted: true,
            ai_context_snapshot: wikiContext || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "brief_id" },
        );
    }

    return json({ ok: true, intent_type: intentType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auto-scope] unhandled error:", msg);
    return json({ error: msg }, 500);
  }
});
