// supabase/functions/analyze-brief-sow/index.ts
//
// Request:  POST {
//   brief_id: string,
//   sow_slugs?: string[],            // explicit SOW selection (first run / re-run)
//   persist_client_sows?: boolean,   // remember sow_slugs on client_sows
//   force?: boolean                  // also replace approved placements
// }
// Response (suggest mode — no SOW link exists yet, no DB writes):
//   200 { ok: true, needs_sow_selection: true, suggested_slugs, available }
// Response (analyze mode):
//   200 { ok: true, sow_slugs, placements }   // inserted + kept approved rows
//   404 brief / SOWs not found · 502 AI returned non-JSON · 4xx/5xx { error }
//
// Extracts discrete asks from the brief itself (brief_intelligence.requirements
// is null in practice) and classifies each against the selected master SOW
// bodies via Claude. Approved placements survive re-analysis unless force=true.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";
import {
  buildAnalyzeSystem,
  buildAnalyzeUser,
  buildSuggestUser,
  extractText,
  makeTaskRef,
  parseScopeMapItems,
  parseSuggestedSlugs,
  SUGGEST_SYSTEM,
  type CatalogueService,
  type ScopeRow,
  type ServiceArea,
  type SowSummary,
  type SowWithBody,
} from "../_shared/scope-map-logic.ts";

const MODEL = "claude-sonnet-4-6";

type Body = {
  brief_id: string;
  sow_slugs?: string[];
  persist_client_sows?: boolean;
  force?: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as Body;
    if (!body.brief_id) return json({ error: "brief_id required" }, 400);

    const sb = createUserClient(req);

    // 1. Load brief (404 if missing) + optional scope notes.
    const { data: brief, error: briefErr } = await sb
      .from("briefs")
      .select("id, client_id, raw_subject, raw_body, sender_email, intent_type, parent_project_id")
      .eq("id", body.brief_id)
      .single();
    if (briefErr || !brief) {
      return json({ error: briefErr?.message ?? "Brief not found" }, 404);
    }

    const { data: scope } = await sb
      .from("scopes")
      .select("enhanced_prose, in_scope_md, out_of_scope_md, open_questions_md")
      .eq("brief_id", body.brief_id)
      .maybeSingle();

    const subject = (brief.raw_subject as string | null) ?? "";
    const briefBody = (brief.raw_body as string | null) ?? "";

    // 2. Resolve SOW slugs: explicit selection wins, else the client's saved link.
    let slugs: string[] = Array.isArray(body.sow_slugs) ? body.sow_slugs.filter(Boolean) : [];
    if (slugs.length === 0 && brief.client_id) {
      const { data: links, error: linkErr } = await sb
        .from("client_sows")
        .select("sow_slug")
        .eq("client_id", brief.client_id)
        .eq("status", "active");
      if (linkErr) return json({ error: linkErr.message }, 500);
      slugs = ((links ?? []) as Array<{ sow_slug: string }>).map((l) => l.sow_slug);
    }

    // 3. Suggest mode — no SOW link yet: propose slugs, write nothing.
    if (slugs.length === 0) {
      const { data: allSows, error: sowsErr } = await sb
        .from("master_sows")
        .select("slug, title")
        .order("title");
      if (sowsErr) return json({ error: sowsErr.message }, 500);
      const available = (allSows ?? []) as SowSummary[];

      let suggested: string[] = [];
      try {
        const raw = await callAnthropic({
          model: MODEL,
          system: SUGGEST_SYSTEM,
          messages: [{
            role: "user",
            content: buildSuggestUser({ sows: available, subject, body: briefBody }),
          }],
          maxTokens: 500,
        });
        suggested = parseSuggestedSlugs(
          extractText(raw),
          new Set(available.map((s) => s.slug)),
        );
      } catch (e) {
        // Best-effort: the selection card still works without suggestions.
        console.error("[analyze-brief-sow] suggest call failed:", e);
      }

      return json({ ok: true, needs_sow_selection: true, suggested_slugs: suggested, available });
    }

    // 4. Remember the confirmed selection on the client (asked once, never again).
    if (body.persist_client_sows && (body.sow_slugs?.length ?? 0) > 0 && brief.client_id) {
      const rows = (body.sow_slugs ?? []).filter(Boolean).map((slug) => ({
        client_id: brief.client_id,
        sow_slug: slug,
        status: "active",
      }));
      const { error: upsertErr } = await sb
        .from("client_sows")
        .upsert(rows, { onConflict: "client_id,sow_slug" });
      if (upsertErr) return json({ error: upsertErr.message }, 500);
    }

    // 5. Analyze mode — load SOW bodies, service areas (may be empty), catalogue.
    const [sowsRes, areasRes, servicesRes] = await Promise.all([
      sb.from("master_sows").select("slug, title, body_md").in("slug", slugs),
      sb.from("sow_service_areas").select("id, name, sow_slug").in("sow_slug", slugs),
      sb.from("services").select("id, code, name, sell_price_cents").eq("status", "active"),
    ]);
    if (sowsRes.error) return json({ error: sowsRes.error.message }, 500);
    if (servicesRes.error) return json({ error: servicesRes.error.message }, 500);
    if (areasRes.error) {
      // Service areas are optional grouping — never block the analysis on them.
      console.error("[analyze-brief-sow] sow_service_areas load failed:", areasRes.error.message);
    }

    const sows = (sowsRes.data ?? []) as SowWithBody[];
    if (sows.length === 0) {
      return json({ error: "No master SOWs found for the given slugs" }, 404);
    }
    const serviceAreas = (areasRes.data ?? []) as ServiceArea[];
    const services = (servicesRes.data ?? []) as CatalogueService[];

    const raw = await callAnthropic({
      model: MODEL,
      system: buildAnalyzeSystem({ sows, serviceAreas, services }),
      messages: [{
        role: "user",
        content: buildAnalyzeUser({ subject, body: briefBody, scope: (scope ?? null) as ScopeRow | null }),
      }],
      maxTokens: 4000,
      cacheSystem: true,
    });

    const text = extractText(raw);
    const items = parseScopeMapItems(text, {
      allowedSlugs: new Set(sows.map((s) => s.slug)),
      serviceAreaIds: new Set(serviceAreas.map((a) => a.id)),
      services,
    });
    if (!items) return json({ error: "AI returned non-JSON output", raw: text }, 502);

    // 6. Persist — approved rows survive re-analysis unless force.
    const { data: existing, error: existErr } = await sb
      .from("brief_task_sow_placements")
      .select("*")
      .eq("brief_id", body.brief_id);
    if (existErr) return json({ error: existErr.message }, 500);

    const kept: Array<Record<string, unknown>> = body.force
      ? []
      : ((existing ?? []) as Array<Record<string, unknown>>).filter((r) => r.approved_at !== null);

    let delQuery = sb
      .from("brief_task_sow_placements")
      .delete()
      .eq("brief_id", body.brief_id);
    if (!body.force) delQuery = delQuery.is("approved_at", null);
    const { error: delErr } = await delQuery;
    if (delErr) return json({ error: delErr.message }, 500);

    const keptRefs = new Set(kept.map((r) => r.task_ref as string));
    const rows = items
      .map((item, i) => ({
        brief_id: body.brief_id,
        task_ref: makeTaskRef(i, item.item_name),
        item_name: item.item_name,
        item_description: item.item_description,
        sow_slug: item.sow_slug,
        service_area_id: item.service_area_id,
        is_inside: item.is_inside,
        ai_confidence: item.ai_confidence,
        ai_match_quote: item.ai_match_quote,
        suggested_service_id: item.suggested_service_id,
        estimated_cents: item.estimated_cents,
      }))
      .filter((r) => !keptRefs.has(r.task_ref));

    let inserted: Array<Record<string, unknown>> = [];
    if (rows.length > 0) {
      const { data: ins, error: insErr } = await sb
        .from("brief_task_sow_placements")
        .insert(rows)
        .select();
      if (insErr) return json({ error: insErr.message }, 500);
      inserted = (ins ?? []) as Array<Record<string, unknown>>;
    }

    return json({
      ok: true,
      sow_slugs: sows.map((s) => s.slug),
      placements: [...inserted, ...kept],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
