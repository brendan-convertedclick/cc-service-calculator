// supabase/functions/match-tasks-to-sow/index.ts
//
// DEPRECATED — superseded by analyze-brief-sow. The old SowCheck UI that
// called this function was rewritten to use analyze-brief-sow (scope map).
// Slated for removal once no callers remain.
//
// Request:  POST {
//   brief_id: string,
//   sow_slug: string,
//   service_areas: [{ id, name, description }],
//   tasks: [{ task_ref, name, description? }]
// }
// Response: 200 { placements: [{ task_ref, is_inside, service_area_id, ai_confidence, ai_match_quote }] }
//
// Calls Claude (Sonnet) to classify each proposed task as inside vs outside
// the active SoW. Returns structured per-task placement decisions. Results
// are persisted by the caller into brief_task_sow_placements.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { callAnthropic } from "../_shared/anthropic.ts";

type Body = {
  brief_id: string;
  sow_slug: string;
  service_areas: Array<{ id: string; name: string; description?: string | null }>;
  tasks: Array<{ task_ref: string; name: string; description?: string }>;
};

type AiPlacement = {
  task_ref: string;
  is_inside: boolean;
  service_area_id: string | null;
  ai_confidence: number;
  ai_match_quote: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as Body;
    if (!body.brief_id || !body.sow_slug || !body.tasks) {
      return json({ error: "brief_id, sow_slug, tasks required" }, 400);
    }
    const sb = createUserClient(req);

    const { data: sow, error: sowErr } = await sb
      .from("master_sows")
      .select("body_md, title")
      .eq("slug", body.sow_slug)
      .single();
    if (sowErr || !sow) return json({ error: sowErr?.message ?? "SoW not found" }, 404);

    const areaList = body.service_areas
      .map((a) => `- id=${a.id} · name="${a.name}"${a.description ? ` · ${a.description}` : ""}`)
      .join("\n");
    const taskList = body.tasks
      .map(
        (t, i) =>
          `${i + 1}. task_ref=${t.task_ref}\n   name: ${t.name}` +
          (t.description ? `\n   detail: ${t.description}` : ""),
      )
      .join("\n");

    const system =
      `You are reviewing a proposed task list against a Statement of Work (SoW) ` +
      `to decide which tasks are covered by the SoW and which fall outside it. ` +
      `For each task, output a JSON object with task_ref, is_inside (boolean), ` +
      `service_area_id (uuid from the list, or null if outside), ai_confidence ` +
      `(0..1), and ai_match_quote (a short quote from the SoW that justifies the ` +
      `decision; for outside tasks, a brief reason instead). Return ONLY a JSON ` +
      `array, nothing else.`;

    const user =
      `# SoW: ${sow.title}\n\n${sow.body_md}\n\n` +
      `# Service areas (use these uuids if inside)\n${areaList || "(none defined)"}\n\n` +
      `# Proposed tasks\n${taskList}\n\n` +
      `# Output schema (JSON array)\n` +
      `[{ "task_ref": "...", "is_inside": true, "service_area_id": "<uuid|null>", ` +
      `"ai_confidence": 0.92, "ai_match_quote": "…" }]`;

    const raw = await callAnthropic({
      model: "claude-sonnet-4-6",
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 2000,
    });

    const text = extractText(raw);
    const parsed = safeParseArray<AiPlacement>(text);
    if (!parsed) return json({ error: "AI returned non-JSON output", raw: text }, 502);

    // Defensive: enforce schema and reject placements whose service_area_id
    // isn't in the supplied list.
    const validIds = new Set(body.service_areas.map((a) => a.id));
    const placements: AiPlacement[] = parsed
      .filter((p) => typeof p.task_ref === "string" && typeof p.is_inside === "boolean")
      .map((p) => ({
        task_ref: p.task_ref,
        is_inside: p.is_inside,
        service_area_id: p.is_inside && p.service_area_id && validIds.has(p.service_area_id)
          ? p.service_area_id
          : null,
        ai_confidence: clamp(Number(p.ai_confidence) || 0, 0, 1),
        ai_match_quote: String(p.ai_match_quote ?? ""),
      }));

    return json({ placements });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function extractText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const content = (raw as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => c.text ?? "").join("");
}

function safeParseArray<T>(text: string): T[] | null {
  const trimmed = text.trim();
  const m = trimmed.match(/\[[\s\S]*\]/);
  const jsonStr = m ? m[0] : trimmed;
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
