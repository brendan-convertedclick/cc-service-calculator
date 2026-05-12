// supabase/functions/get-output-multiplier/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { periodRange, computeMultiplier } from "../_shared/output-multiplier-logic.ts";

type ViewType = "direct" | "parallel" | "passive";
type PeriodType = "year" | "month" | "week";

interface RequestBody {
  view: ViewType;
  period: PeriodType;
  date: string;
  logged_by?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { view, period, date, logged_by } = body;
  if (!view || !period || !date) {
    return json({ error: "view, period, and date are required" }, 400);
  }

  const pr = periodRange(period, date);
  const sb = createServiceRoleClient();

  if (view === "direct") return directView(sb, pr, logged_by);
  if (view === "parallel") return parallelView(sb, pr, logged_by);
  if (view === "passive") return passiveView(sb, pr, logged_by);

  return json({ error: `unknown view: ${view}` }, 400);
});

// ─── Direct view ────────────────────────────────────────────────────────────

async function directView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  logged_by?: string,
) {
  const { data, error } = await sb.rpc("get_direct_multiplier", {
    p_start: pr.startDate,
    p_end: pr.endDate,
    p_logged_by: logged_by ?? null,
  });
  if (error) return json({ error: error.message }, 500);

  const members = (data as Array<{
    logged_by: string;
    display_name: string;
    human_hours: number;
    ai_session_hours: number;
    ai_cost_zar: number;
  }>).map((row) => {
    const multiplier = computeMultiplier(row.human_hours, row.ai_session_hours);
    return {
      email: row.logged_by,
      display_name: row.display_name,
      human_hours: row.human_hours,
      ai_session_hours: row.ai_session_hours,
      ai_cost_zar: row.ai_cost_zar,
      multiplier,
      effective_output_hours: row.human_hours * multiplier,
    };
  });

  const avgMultiplier =
    members.length > 0
      ? members.reduce((s, m) => s + m.multiplier, 0) / members.length
      : 0;

  return json({
    periodLabel: pr.label,
    members,
    totals: {
      avg_multiplier: Math.round(avgMultiplier * 10) / 10,
      total_human_hours: members.reduce((s, m) => s + m.human_hours, 0),
      total_ai_hours: members.reduce((s, m) => s + m.ai_session_hours, 0),
      total_cost_zar: members.reduce((s, m) => s + m.ai_cost_zar, 0),
    },
  });
}

// ─── Parallel view ───────────────────────────────────────────────────────────

async function parallelView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  logged_by?: string,
) {
  let query = sb
    .from("ai_sessions")
    .select("session_date, concurrent_sessions, project_slug, ai_duration_minutes, logged_by")
    .gte("session_date", pr.startDate)
    .lt("session_date", pr.endDate)
    .eq("engagement_type", "task")
    .order("session_date");

  if (logged_by) query = query.eq("logged_by", logged_by);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const byDate = new Map<string, {
    sessions: Array<{ slot: number; project_slug: string; duration_minutes: number }>;
    concurrent_count: number;
  }>();

  for (const row of data ?? []) {
    const key = row.session_date as string;
    if (!byDate.has(key)) byDate.set(key, { sessions: [], concurrent_count: 0 });
    const entry = byDate.get(key)!;
    const slot = entry.sessions.length + 1;
    entry.sessions.push({
      slot,
      project_slug: (row.project_slug as string) ?? "unknown",
      duration_minutes: Number(row.ai_duration_minutes),
    });
    entry.concurrent_count = Math.max(
      entry.concurrent_count,
      row.concurrent_sessions as number,
    );
  }

  const days = Array.from(byDate.entries()).map(([date, val]) => {
    const wallClock = val.sessions.reduce((s, r) => s + r.duration_minutes, 0) /
      Math.max(val.concurrent_count, 1);
    return {
      date,
      sessions: val.sessions,
      concurrent_count: val.concurrent_count,
      parallel_multiplier:
        Math.round((val.sessions.reduce((s, r) => s + r.duration_minutes, 0) /
          Math.max(wallClock, 1)) * 10) / 10,
    };
  });

  const totalParallelHours = days.reduce(
    (s, d) => s + d.sessions.reduce((ss, r) => ss + r.duration_minutes, 0) / 60,
    0,
  );
  const peakConcurrent = days.reduce((s, d) => Math.max(s, d.concurrent_count), 0);
  const avgConcurrent =
    days.length > 0
      ? days.reduce((s, d) => s + d.concurrent_count, 0) / days.length
      : 0;

  return json({
    periodLabel: pr.label,
    days,
    summary: {
      avg_concurrent: Math.round(avgConcurrent * 10) / 10,
      peak_concurrent: peakConcurrent,
      parallel_output_hours: Math.round(totalParallelHours * 10) / 10,
      wall_clock_hours: Math.round((totalParallelHours / Math.max(avgConcurrent, 1)) * 10) / 10,
    },
  });
}

// ─── Passive view ────────────────────────────────────────────────────────────

async function passiveView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  logged_by?: string,
) {
  const { data: settingsData } = await sb
    .from("settings")
    .select("blended_hourly_rate_zar")
    .eq("id", 1)
    .single();
  const blendedRate = (settingsData?.blended_hourly_rate_zar as number) ?? 350;

  let query = sb
    .from("ai_sessions")
    .select("agent_id, agents(name, description, estimated_human_hours_per_run, creator)")
    .eq("engagement_type", "agent-run")
    .gte("session_date", pr.startDate)
    .lt("session_date", pr.endDate)
    .not("agent_id", "is", null);

  if (logged_by) {
    query = query.eq("agents.creator", logged_by);
  }

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const byAgent = new Map<string, {
    name: string;
    description: string;
    estimated_human_hours_per_run: number;
    runs: number;
  }>();

  for (const row of data ?? []) {
    const agent = row.agents as {
      name: string;
      description: string;
      estimated_human_hours_per_run: number;
      creator: string;
    } | null;
    if (!agent) continue;
    if (logged_by && agent.creator !== logged_by) continue;

    const key = row.agent_id as string;
    if (!byAgent.has(key)) {
      byAgent.set(key, {
        name: agent.name,
        description: agent.description,
        estimated_human_hours_per_run: agent.estimated_human_hours_per_run,
        runs: 0,
      });
    }
    byAgent.get(key)!.runs++;
  }

  const agents = Array.from(byAgent.entries()).map(([id, val]) => {
    const estimated_human_hours = val.runs * val.estimated_human_hours_per_run;
    return {
      id,
      name: val.name,
      description: val.description,
      runs: val.runs,
      estimated_human_hours: Math.round(estimated_human_hours * 10) / 10,
      blended_cost_zar: Math.round(estimated_human_hours * blendedRate),
    };
  }).sort((a, b) => b.estimated_human_hours - a.estimated_human_hours);

  const totals = {
    total_runs: agents.reduce((s, a) => s + a.runs, 0),
    total_passive_hours: agents.reduce((s, a) => s + a.estimated_human_hours, 0),
    total_cost_zar: agents.reduce((s, a) => s + a.blended_cost_zar, 0),
  };

  return json({ periodLabel: pr.label, agents, totals });
}
