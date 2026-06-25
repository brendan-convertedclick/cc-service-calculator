// supabase/functions/parse-retainer-invoice/index.ts
//
// Request:  POST { pdf_base64: string }   (base64 of a retainer invoice PDF)
// Response: 200 { line_items: ParsedLine[] }
//
// Sends the invoice PDF to Claude along with the active services catalogue and
// asks it to extract each billable line item and match it to the best-fitting
// service. The New Retainer wizard turns each returned line into an editable
// recurring-service row (cost → hours via the blended rate). No data is written
// here — pure extraction.
//
// NOTE: requires the ANTHROPIC_API_KEY secret. This is AI beyond process-step
// generation (a deliberate V1 scope expansion for invoice import).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";

type ParsedLine = {
  description: string;
  full_description: string;
  qty: number;
  unit_price_cents: number;
  amount_cents: number;
  suggested_service_id: string | null;
  suggested_service_name: string | null;
  match_confidence: "high" | "medium" | "low" | "none";
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { pdf_base64 } = (await req.json()) as { pdf_base64?: string };
    if (!pdf_base64) return json({ error: "pdf_base64 required" }, 400);
    // Strip a data-URL prefix if the client sent one.
    const b64 = pdf_base64.includes(",") ? pdf_base64.slice(pdf_base64.indexOf(",") + 1) : pdf_base64;

    const sb = createServiceRoleClient();
    const { data: settings } = await sb.from("settings").select("anthropic_model, anthropic_enabled").eq("id", 1).single();
    if (settings && settings.anthropic_enabled === false) {
      return json({ error: "AI is disabled in settings." }, 400);
    }
    const model = (settings?.anthropic_model as string) || DEFAULT_MODEL;

    const { data: services } = await sb
      .from("services")
      .select("id, name, code")
      .eq("status", "active")
      .order("name");

    const catalogue = (services ?? [])
      .map((s) => `${s.id}\t${s.name}${s.code ? ` (${s.code})` : ""}`)
      .join("\n");

    const system =
      "You extract billable line items from a marketing agency retainer invoice PDF and match each " +
      "to the single best-fitting service from a provided catalogue. Be precise with numbers. " +
      "Match by meaning (e.g. a blog-writing line → a blog/content service). Output ONLY a valid " +
      "JSON object — no markdown fences, no commentary.";

    const instructions =
      `Service catalogue (id<TAB>name), choose suggested_service_id ONLY from these ids or use null:\n` +
      `${catalogue}\n\n` +
      `Extract every billable line item from the attached invoice. Ignore subtotal/VAT/total rows. ` +
      `Return JSON of this exact shape:\n` +
      `{"line_items":[{` +
      `"description": "<concise label, e.g. 'Paid Media Optimisation'>",` +
      `"full_description": "<the full line description text>",` +
      `"qty": <number>,` +
      `"unit_price": <number, in Rand>,` +
      `"amount": <number, in Rand, the line total>,` +
      `"suggested_service_id": "<catalogue id or null>",` +
      `"match_confidence": "high|medium|low|none"` +
      `}]}`;

    const resp = await callAnthropic({
      model,
      system,
      maxTokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: instructions },
          ],
        },
      ],
    });

    const text = resp.content?.map((c) => c.text ?? "").join("") ?? "";
    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.line_items)) {
      return json({ error: "Could not parse invoice", raw: text.slice(0, 2000) }, 422);
    }

    const nameById = new Map((services ?? []).map((s) => [s.id, s.name]));
    const line_items: ParsedLine[] = parsed.line_items.map((l: Record<string, unknown>) => {
      const sid = typeof l.suggested_service_id === "string" && nameById.has(l.suggested_service_id)
        ? l.suggested_service_id
        : null;
      return {
        description: String(l.description ?? "").trim(),
        full_description: String(l.full_description ?? l.description ?? "").trim(),
        qty: Number(l.qty) || 1,
        unit_price_cents: Math.round((Number(l.unit_price) || 0) * 100),
        amount_cents: Math.round((Number(l.amount) || 0) * 100),
        suggested_service_id: sid,
        suggested_service_name: sid ? nameById.get(sid) ?? null : null,
        match_confidence: (["high", "medium", "low", "none"].includes(String(l.match_confidence))
          ? l.match_confidence
          : "none") as ParsedLine["match_confidence"],
      };
    });

    return json({ line_items });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Pull the first JSON object out of the model's text, tolerating ```json fences
// or leading/trailing prose.
function extractJson(text: string): { line_items?: unknown[] } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
