import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";

// Request: { service_id: string }
// Response: { steps: Array<{ title: string; description?: string; department_id: string|null; estimated_hours?: number|null }> }
// Auth: verify_jwt is on; the caller's JWT is forwarded to the Supabase client so RLS applies.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { service_id } = await req.json();
    if (!service_id) return json({ error: "service_id required" }, 400);

    const supabase = createUserClient(req);

    const { data: settings } = await supabase
      .from("settings").select("anthropic_model").eq("id", 1).single();
    const model = settings?.anthropic_model ?? "claude-sonnet-4-6";

    const { data: service, error: sErr } = await supabase
      .from("services").select("*").eq("id", service_id).single();
    if (sErr || !service) return json({ error: sErr?.message ?? "Service not found" }, 404);

    const { data: depts } = await supabase
      .from("departments").select("id,name,hourly_rate_cents").is("archived_at", null);
    const { data: resolved } = await supabase
      .from("service_allocation_resolved").select("*").eq("service_id", service_id);

    const allocationLines = (resolved ?? [])
      .map((r: { department_id: string; pct: number | null; hours: number | null }) => {
        const d = depts?.find((x: { id: string }) => x.id === r.department_id);
        return `  - ${d?.name ?? "Unknown"}: ${r.pct}% → ${r.hours ?? 0} hrs budget`;
      })
      .join("\n");

    const systemPrompt = [
      "You are an agency operations expert at Converted Click, a South African digital agency. You design process flows for client-facing services.",
      "",
      "Output requirements:",
      "- Return 5 to 10 ordered steps from brief intake to delivery and sign-off.",
      "- Each step must have: title (max 8 words), description (1-2 sentences), department_id (pick from the list — null if unclear), estimated_hours (number or null).",
      "- Hours should roughly sum to the service's total budgeted hours.",
      "- Use the department ids provided verbatim. Do NOT invent new ids.",
      "- Be concrete about what gets done in each step. Avoid filler like 'review and approve' unless it is the final QA step.",
      "",
      "Available departments:",
      (depts ?? []).map((d: { id: string; name: string }) => `  ${d.id} — ${d.name}`).join("\n"),
      "",
      "Respond with JSON only, no prose, shape: {\"steps\":[{\"title\":\"\",\"description\":\"\",\"department_id\":\"\",\"estimated_hours\":0}]}",
    ].join("\n");

    const userPrompt = [
      `Service: ${service.name}`,
      service.code ? `Code: ${service.code}` : null,
      `Pricing: ${service.pricing_model}${service.sell_price_cents ? `, price R${(service.sell_price_cents / 100).toFixed(0)}` : ""}`,
      service.scope_definition ? `Scope: ${service.scope_definition}` : null,
      service.included_revisions ? `Revisions included: ${service.included_revisions}` : null,
      service.trigger_to_start ? `Trigger to start: ${service.trigger_to_start}` : null,
      service.completion_definition ? `Definition of done: ${service.completion_definition}` : null,
      "",
      "Allocation (price share × department rate = hours):",
      allocationLines || "  (no allocation set)",
    ].filter(Boolean).join("\n");

    const body = await callAnthropic({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 2048,
      cacheSystem: true,
    });

    const text: string = body.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "AI did not return JSON", raw: text }, 502);

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.steps)) return json({ error: "AI JSON missing steps array", raw: text }, 502);

    const knownDeptIds = new Set((depts ?? []).map((d: { id: string }) => d.id));
    const steps = parsed.steps.map((s: {
      title?: string;
      description?: string;
      department_id?: string | null;
      estimated_hours?: number | null;
    }) => ({
      title: String(s.title ?? "Step").slice(0, 120),
      description: s.description ? String(s.description).slice(0, 1000) : null,
      department_id: s.department_id && knownDeptIds.has(s.department_id) ? s.department_id : null,
      estimated_hours:
        typeof s.estimated_hours === "number" && Number.isFinite(s.estimated_hours)
          ? Math.round(s.estimated_hours * 100) / 100
          : null,
    }));

    return json({ steps });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Anthropic ")) return json({ error: msg }, 502);
    return json({ error: msg }, 500);
  }
});
