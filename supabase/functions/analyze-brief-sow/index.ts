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
//   200 { ok: true, sow_slugs, placements }   // upserted + kept approved rows
//   404 brief / SOWs not found · 422 no asks extracted ·
//   502 AI returned non-JSON / response truncated · 4xx/5xx { error }
//
// Extraction source, in priority order:
//   1. brief_intelligence.requirements (intake-created briefs) — deterministic,
//      no AI call, and no SOW-selection gate; intake already mapped services.
//   2. Claude extraction against the selected master SOW bodies.
//   3. Keyword heuristic when ANTHROPIC_API_KEY is unavailable.
// Approved placements survive re-analysis unless force=true.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";
import {
  buildAnalyzeSystem,
  buildAnalyzeUser,
  buildSeedTasksForPlacement,
  buildSuggestUser,
  extractText,
  heuristicScopeItems,
  intelligenceScopeItems,
  makeTaskRef,
  parseScopeMapItems,
  parseSuggestedSlugs,
  serviceCodeKey,
  type AssumedExclusion,
  type IntelligenceRequirement,
  type SeedAllocation,
  type SeedProcessStep,
  SUGGEST_SYSTEM,
  type CatalogueService,
  type ScopeRow,
  type ServiceArea,
  type SowSummary,
  type SowWithBody,
} from "../_shared/scope-map-logic.ts";
import { getClientAllowances } from "../_shared/scope-allowances.ts";
import {
  resolveDisposition,
  type CatalogService,
} from "../_shared/scope-disposition.ts";

const MODEL = "claude-sonnet-4-6";

type Body = {
  brief_id: string;
  sow_slugs?: string[];
  persist_client_sows?: boolean;
  force?: boolean;
};

/**
 * Seed placement_tasks (the per-line "Team tasks · scheduled in ClickUp"
 * breakdown) for every matched billable placement that has no tasks yet.
 * Deterministic — sourced from each service's authored process_steps, else its
 * resolved department allocation. No AI. Idempotent + non-destructive: lines
 * that already carry tasks are skipped.
 */
async function seedPlacementTasks(
  // deno-lint-ignore no-explicit-any
  sb: any,
  briefId: string,
  placements: Array<Record<string, unknown>>,
  serviceNameById: Map<string, string>,
): Promise<void> {
  const targets = placements.filter(
    (p) => typeof p.suggested_service_id === "string" && typeof p.id === "string",
  );
  if (targets.length === 0) return;

  const placementIds = targets.map((p) => p.id as string);
  const serviceIds = [...new Set(targets.map((p) => p.suggested_service_id as string))];

  // Skip placements that already have tasks (operator edits / prior seed).
  const { data: existing } = await sb
    .from("placement_tasks")
    .select("placement_id")
    .in("placement_id", placementIds);
  const hasTasks = new Set(
    ((existing ?? []) as Array<{ placement_id: string }>).map((t) => t.placement_id),
  );

  const [stepsRes, allocRes] = await Promise.all([
    sb.from("process_steps")
      .select("service_id, ordinal, title, department_id, estimated_hours")
      .in("service_id", serviceIds),
    sb.from("service_allocation_resolved")
      .select("service_id, department_id, hours")
      .in("service_id", serviceIds),
  ]);

  const stepsBySvc = new Map<string, SeedProcessStep[]>();
  for (const s of (stepsRes.data ?? []) as Array<{ service_id: string } & SeedProcessStep>) {
    const arr = stepsBySvc.get(s.service_id) ?? [];
    arr.push({ ordinal: s.ordinal, title: s.title, department_id: s.department_id, estimated_hours: s.estimated_hours });
    stepsBySvc.set(s.service_id, arr);
  }
  const allocBySvc = new Map<string, SeedAllocation[]>();
  for (const a of (allocRes.data ?? []) as Array<{ service_id: string } & SeedAllocation>) {
    const arr = allocBySvc.get(a.service_id) ?? [];
    arr.push({ department_id: a.department_id, hours: a.hours });
    allocBySvc.set(a.service_id, arr);
  }

  const rows = targets
    .filter((p) => !hasTasks.has(p.id as string))
    .flatMap((p) => {
      const svcId = p.suggested_service_id as string;
      const qtyNum = Number(p.quantity);
      return buildSeedTasksForPlacement({
        placementId: p.id as string,
        briefId,
        quantity: Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1,
        steps: stepsBySvc.get(svcId) ?? [],
        allocation: allocBySvc.get(svcId) ?? [],
        serviceName: serviceNameById.get(svcId) ?? (typeof p.item_name === "string" ? p.item_name : "Deliverable"),
      });
    });

  if (rows.length > 0) {
    const { error } = await sb.from("placement_tasks").insert(rows);
    if (error) console.error("[analyze-brief-sow] placement_tasks insert failed:", error.message);
  }
}

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

    // 1b. Intake-created briefs carry pre-extracted, service-mapped requirements
    //     in brief_intelligence — the source of truth for scope items. When
    //     present, extraction below is deterministic (no AI, no heuristic) and
    //     the SOW-selection gate is skipped: intake did all the work already.
    const { data: intel } = await sb
      .from("brief_intelligence")
      .select("requirements, assumed_exclusions")
      .eq("brief_id", body.brief_id)
      .maybeSingle();
    const intelRequirements = (intel?.requirements ?? null) as
      | IntelligenceRequirement[]
      | null;
    const assumedExclusions = (intel?.assumed_exclusions ?? null) as
      | AssumedExclusion[]
      | null;
    const hasIntel =
      Array.isArray(intelRequirements) &&
      intelRequirements.some(
        (r) =>
          (r.mapped_services?.length ?? 0) > 0 ||
          (r.mapped_service_ids?.length ?? 0) > 0,
      );

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
    //    Skipped for intelligence-seeded briefs: their items don't need a SOW
    //    body to classify (disposition comes from the allowance ledger), so
    //    the operator is never blocked on a selection card.
    if (slugs.length === 0 && !hasIntel) {
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
      // Only deliverable services are catalogue-matchable for the Scope Ledger Rail.
      sb
        .from("services")
        .select("id, code, name, sell_price_cents, unit_of_sale, is_deliverable")
        .eq("status", "active")
        .eq("is_deliverable", true),
    ]);
    if (sowsRes.error) return json({ error: sowsRes.error.message }, 500);
    if (servicesRes.error) return json({ error: servicesRes.error.message }, 500);
    if (areasRes.error) {
      // Service areas are optional grouping — never block the analysis on them.
      console.error("[analyze-brief-sow] sow_service_areas load failed:", areasRes.error.message);
    }

    const sows = (sowsRes.data ?? []) as SowWithBody[];
    if (sows.length === 0 && !hasIntel) {
      return json({ error: "No master SOWs found for the given slugs" }, 404);
    }
    const serviceAreas = (areasRes.data ?? []) as ServiceArea[];
    const services = (servicesRes.data ?? []) as CatalogueService[];

    // Scope Ledger Rail: catalog keyed by Xero code for the deterministic
    // disposition resolver. Only deliverable services are loaded above, so a
    // whitelisted matched_service_code always resolves here; an unmatched ask
    // (null code) falls through to out_of_scope inside resolveDisposition.
    // Codeless services key as `id:<uuid>` (serviceCodeKey) so intelligence-
    // mapped items can resolve; the LLM/heuristic paths only ever emit real
    // Xero codes, which serviceCodeKey passes through unchanged.
    const catalogByCode = new Map<string, CatalogService>(
      services.map((s) => [
        serviceCodeKey(s),
        {
          id: s.id,
          code: s.code,
          is_deliverable: s.is_deliverable !== false,
          sell_price_cents: s.sell_price_cents ?? 0,
        },
      ]),
    );
    // service id → name, for labelling seeded team tasks (step 7).
    const serviceNameById = new Map<string, string>(services.map((s) => [s.id, s.name]));

    // The client's coverage ledger (retainer entitlements + fixed-project
    // membership). Empty when the brief has no client — every deliverable ask
    // then falls to new_billable, which is the correct default.
    let allowances: Awaited<ReturnType<typeof getClientAllowances>> = [];
    if (brief.client_id) {
      try {
        allowances = await getClientAllowances(sb, brief.client_id as string);
      } catch (e) {
        // Never block the analysis on a ledger read — degrade to "no coverage"
        // (everything deliverable becomes new_billable) and log for triage.
        console.error("[analyze-brief-sow] getClientAllowances failed:", e);
      }
    }

    // Extract asks + match catalogue codes. Prefer Claude; fall back to a
    // deterministic keyword heuristic when ANTHROPIC_API_KEY is unavailable or
    // the call fails, so a brief can always be built with no AI. Either way the
    // three-way disposition is assigned deterministically by resolveDisposition
    // below — the model (or heuristic) only extracts and catalogue-matches.
    let items: ReturnType<typeof parseScopeMapItems> = null;
    if (hasIntel) {
      items = intelligenceScopeItems({
        requirements: intelRequirements ?? [],
        services,
        slugs,
        assumedExclusions: Array.isArray(assumedExclusions) ? assumedExclusions : null,
      });
      console.log(
        `[analyze-brief-sow] seeded ${items.length} item(s) from brief_intelligence — no AI call`,
      );
    }
    if (items && items.length > 0) {
      // Intelligence path complete — skip AI/heuristic extraction entirely.
    } else if (Deno.env.get("ANTHROPIC_API_KEY")) {
      try {
        const raw = await callAnthropic({
          model: MODEL,
          system: buildAnalyzeSystem({ sows, serviceAreas, services }),
          messages: [{
            role: "user",
            content: buildAnalyzeUser({ subject, body: briefBody, scope: (scope ?? null) as ScopeRow | null }),
          }],
          maxTokens: 8000,
          cacheSystem: true,
        });
        if (raw.stop_reason === "max_tokens") {
          return json({ error: "AI response truncated — brief has too many asks" }, 502);
        }
        items = parseScopeMapItems(extractText(raw), {
          allowedSlugs: new Set(sows.map((s) => s.slug)),
          serviceAreaIds: new Set(serviceAreas.map((a) => a.id)),
          services,
        });
        if (!items) return json({ error: "AI returned non-JSON output" }, 502);
      } catch (e) {
        console.error("[analyze-brief-sow] AI analyze failed — using heuristic:", e);
        items = heuristicScopeItems({ subject, body: briefBody, services, slugs });
      }
    } else {
      console.warn("[analyze-brief-sow] ANTHROPIC_API_KEY not set — heuristic extraction");
      items = heuristicScopeItems({ subject, body: briefBody, services, slugs });
    }

    // Guard BEFORE any write — an empty extraction must never wipe an existing
    // map. The heuristic always returns ≥1 item, so this only trips the AI path.
    if (!items || items.length === 0) {
      return json({ error: "no asks extracted from the brief" }, 422);
    }

    // 6. Persist — approved rows survive re-analysis unless force.
    //    Non-destructive and race-safe: upsert the new rows first, then prune
    //    stale rows. A failed write can never destroy the existing map, and
    //    concurrent runs converge instead of 500ing on the
    //    brief_task_sow_placements_unique (brief_id, task_ref) index.
    const { data: existing, error: existErr } = await sb
      .from("brief_task_sow_placements")
      .select("*")
      .eq("brief_id", body.brief_id);
    if (existErr) return json({ error: existErr.message }, 500);

    const kept: Array<Record<string, unknown>> = body.force
      ? []
      : ((existing ?? []) as Array<Record<string, unknown>>).filter((r) => r.approved_at !== null);

    const keptRefs = new Set(kept.map((r) => r.task_ref as string));
    const rows = items
      .map((item, i) => {
        // Scope Ledger Rail: deterministically assign exactly one disposition
        // from the extracted ask + the client's allowance ledger. The LLM never
        // decides coverage — resolveDisposition is the single source of truth.
        const resolved = resolveDisposition(
          {
            item_name: item.item_name,
            matched_service_code: item.matched_service_code,
            quantity: item.quantity,
            grounding_quote: item.grounding_quote,
            confidence: item.confidence,
          },
          allowances,
          catalogByCode,
        );
        const { disposition } = resolved;
        // Resolver-wins rule: intake's prose reason is only trusted when its
        // expected bucket matches the ledger verdict (or it made no claim).
        // On disagreement the template reason ships and the line is flagged.
        const intakeReasonOk =
          !!item.coverage_reason &&
          (item.expected_disposition == null ||
            item.expected_disposition === disposition);
        const dispositionMismatch =
          item.expected_disposition != null &&
          item.expected_disposition !== disposition;
        const needs_review = resolved.needs_review || dispositionMismatch;
        return {
          brief_id: body.brief_id,
          task_ref: makeTaskRef(i, item.item_name),
          item_name: item.item_name,
          item_description: item.item_description,
          sow_slug: item.sow_slug,
          service_area_id: item.service_area_id,
          // Back-compat: is_inside mirrors the in_agreed_scope bucket so legacy
          // readers keep working. disposition is the new three-way truth.
          is_inside: disposition === "in_agreed_scope",
          ai_confidence: item.ai_confidence,
          ai_match_quote: item.ai_match_quote,
          suggested_service_id: item.suggested_service_id,
          estimated_cents: item.estimated_cents,
          // Scope Ledger Rail fields.
          disposition,
          needs_review,
          quantity: item.quantity,
          grounding_quote: item.grounding_quote,
          // Scope coverage (0087): client-safe why + assumed-work flag.
          // `excluded` is deliberately not written — operator unticks survive
          // re-analysis because the upsert only updates supplied columns.
          client_reason: intakeReasonOk
            ? (item.coverage_reason as string)
            : resolved.client_reason,
          is_assumed: item.is_assumed === true,
          // force replaces approved placements — clear stale approval/override
          // stamps when an old row is overwritten via the upsert conflict path.
          ...(body.force
            ? { approved_at: null, approved_by: null, override_reason: null }
            : {}),
        };
      })
      .filter((r) => !keptRefs.has(r.task_ref));

    let upserted: Array<Record<string, unknown>> = [];
    if (rows.length > 0) {
      const { data: ups, error: upsErr } = await sb
        .from("brief_task_sow_placements")
        .upsert(rows, { onConflict: "brief_id,task_ref" })
        .select();
      if (upsErr) return json({ error: upsErr.message }, 500);
      upserted = (ups ?? []) as Array<Record<string, unknown>>;
    }

    // Only after a successful upsert: delete stale rows from previous analyses.
    // task_refs are makeTaskRef output ([a-z0-9_-] only), so the PostgREST
    // in-list quoting below is safe (same pattern as useBriefs.ts).
    const newRefs = rows.map((r) => r.task_ref);
    let delQuery = sb
      .from("brief_task_sow_placements")
      .delete()
      .eq("brief_id", body.brief_id);
    if (!body.force) delQuery = delQuery.is("approved_at", null);
    if (newRefs.length > 0) {
      delQuery = delQuery.not("task_ref", "in", `(${newRefs.map((r) => `"${r}"`).join(",")})`);
    }
    const { error: delErr } = await delQuery;
    if (delErr) return json({ error: delErr.message }, 500);

    const placements = [...upserted, ...kept];

    // 7. Seed the per-line team-task breakdown (placement_tasks) — deterministic,
    //    NO AI. Every billable line matched to a service gets its ClickUp work
    //    breakdown from the service's authored process_steps, or its resolved
    //    department allocation. Only lines with zero tasks are seeded, so operator
    //    edits and re-runs are never clobbered (placement_tasks cascade-delete with
    //    their placement). Failure here never fails the analysis — the breakdown
    //    can still be added by hand.
    try {
      await seedPlacementTasks(sb, body.brief_id, placements, serviceNameById);
    } catch (e) {
      console.error("[analyze-brief-sow] placement_tasks seeding failed:", e);
    }

    return json({ ok: true, sow_slugs: sows.map((s) => s.slug), placements });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
