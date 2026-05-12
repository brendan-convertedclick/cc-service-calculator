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

// ─── Sub-period bucketing ─────────────────────────────────────────────────────

function isoWeekNum(d: Date): number {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return Math.floor((d.getTime() - startOfWeek1.getTime()) / (7 * 86400000)) + 1;
}

function subBucketKey(period: PeriodType, isoDate: string): string {
  const [y, mo, da] = isoDate.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  if (period === "week") return isoDate;
  if (period === "month") return `${y}-W${String(isoWeekNum(d)).padStart(2, "0")}`;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

function subBucketKeyFromMs(period: PeriodType, ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  if (period === "week") return `${y}-${mo}-${da}`;
  if (period === "month") return `${y}-W${String(isoWeekNum(d)).padStart(2, "0")}`;
  return `${y}-${mo}`;
}

function subBucketLabel(period: PeriodType, key: string): string {
  if (period === "week") {
    const [y, mo, da] = key.split("-").map(Number);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
      new Date(y, mo - 1, da).getDay()
    ];
  }
  if (period === "month") return key.split("-")[1]; // "W20"
  const [y, mo] = key.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-ZA", { month: "short" });
}

// ─── Shared row types ─────────────────────────────────────────────────────────

type MemberRow = {
  email: string;
  display_name: string;
  human_hours: number;
  ai_session_hours: number;
  ai_cost_zar: number;
  multiplier: number;
  effective_output_hours: number;
};

type BreakdownSlice = {
  sub_key: string;
  sub_label: string;
  members: MemberRow[];
};

// ─── Main handler ─────────────────────────────────────────────────────────────

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

  if (view === "direct") return directView(sb, pr, period, logged_by);
  if (view === "parallel") return parallelView(sb, pr, logged_by);
  if (view === "passive") return passiveView(sb, pr, logged_by);

  return json({ error: `unknown view: ${view}` }, 400);
});

// ─── Direct view ──────────────────────────────────────────────────────────────

async function directView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  period: PeriodType,
  logged_by?: string,
) {
  // Build raw AI sessions query (needed for breakdown slices)
  const rawAiQuery = (() => {
    let q = sb.from("ai_sessions")
      .select("logged_by, session_date, ai_duration_minutes, ai_cost_zar")
      .gte("session_date", pr.startDate)
      .lt("session_date", pr.endDate)
      .eq("engagement_type", "task");
    if (logged_by) q = q.eq("logged_by", logged_by);
    return q;
  })();

  // Fetch aggregated RPC + settings + team + raw AI sessions in parallel
  const [aiResult, settingsResult, teamResult, rawAiResult] = await Promise.all([
    sb.rpc("get_direct_multiplier", {
      p_start: pr.startDate,
      p_end: pr.endDate,
      p_logged_by: logged_by ?? null,
    }),
    sb.from("settings")
      .select("clickup_enabled, clickup_workspace_id")
      .eq("id", 1)
      .single(),
    sb.from("team_members")
      .select("email, full_name, clickup_user_id")
      .not("clickup_user_id", "is", null),
    rawAiQuery,
  ]);

  if (aiResult.error) return json({ error: aiResult.error.message }, 500);

  // Build email↔clickup_user_id maps
  const emailToClickupId = new Map<string, number>();
  const clickupIdToEmail = new Map<number, string>();
  for (const tm of teamResult.data ?? []) {
    if (tm.clickup_user_id) {
      emailToClickupId.set(tm.email, Number(tm.clickup_user_id));
      clickupIdToEmail.set(Number(tm.clickup_user_id), tm.email);
    }
  }

  // Fetch ClickUp time entries; keep raw entries for breakdown bucketing
  const humanHoursByEmail = new Map<string, number>();
  let rawTimeEntries: Array<{ duration: string; start: string; user: { id: number } }> = [];
  const settings = settingsResult.data;
  if (settings?.clickup_enabled && settings?.clickup_workspace_id) {
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (clickupPat) {
      const startMs = new Date(pr.startDate).getTime();
      const endMs = new Date(pr.endDate).getTime();
      const timeParams = new URLSearchParams({
        start_date: String(startMs),
        end_date: String(endMs),
      });
      if (logged_by) {
        const cuId = emailToClickupId.get(logged_by);
        if (cuId) timeParams.append("assignee", String(cuId));
      }
      const timeRes = await fetch(
        `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/time_entries?${timeParams}`,
        { headers: { Authorization: clickupPat } },
      );
      if (timeRes.ok) {
        const timeBody = await timeRes.json() as {
          data: Array<{ duration: string; start: string; user: { id: number } }>;
        };
        rawTimeEntries = timeBody.data ?? [];
        for (const entry of rawTimeEntries) {
          const email = clickupIdToEmail.get(Number(entry.user.id));
          if (!email) continue;
          humanHoursByEmail.set(
            email,
            (humanHoursByEmail.get(email) ?? 0) + Number(entry.duration) / 3_600_000,
          );
        }
      }
    }
  }

  const aiRows = aiResult.data as Array<{
    logged_by: string;
    display_name: string;
    human_hours: number;
    ai_session_hours: number;
    ai_cost_zar: number;
  }>;

  const displayNameByEmail = new Map<string, string>(
    aiRows.map((r) => [r.logged_by, r.display_name]),
  );

  // Merge: prefer ClickUp human hours, fall back to ai_sessions.human_minutes
  const members: MemberRow[] = aiRows.map((row) => {
    const humanHours = humanHoursByEmail.has(row.logged_by)
      ? Math.round(humanHoursByEmail.get(row.logged_by)! * 100) / 100
      : row.human_hours;
    const multiplier = computeMultiplier(humanHours, row.ai_session_hours);
    return {
      email: row.logged_by,
      display_name: row.display_name,
      human_hours: humanHours,
      ai_session_hours: row.ai_session_hours,
      ai_cost_zar: row.ai_cost_zar,
      multiplier,
      effective_output_hours: Math.round(humanHours * multiplier * 100) / 100,
    };
  });

  const avgMultiplier =
    members.length > 0
      ? members.reduce((s, m) => s + m.multiplier, 0) / members.length
      : 0;

  const rawAiRows = (rawAiResult.data ?? []) as Array<{
    logged_by: string;
    session_date: string;
    ai_duration_minutes: number;
    ai_cost_zar: number;
  }>;

  const breakdown = buildBreakdown(
    period,
    rawAiRows,
    rawTimeEntries,
    clickupIdToEmail,
    displayNameByEmail,
  );

  return json({
    periodLabel: pr.label,
    members,
    totals: {
      avg_multiplier: Math.round(avgMultiplier * 10) / 10,
      total_human_hours: members.reduce((s, m) => s + m.human_hours, 0),
      total_ai_hours: members.reduce((s, m) => s + m.ai_session_hours, 0),
      total_cost_zar: members.reduce((s, m) => s + m.ai_cost_zar, 0),
    },
    breakdown,
  });
}

function buildBreakdown(
  period: PeriodType,
  rawAiRows: Array<{
    logged_by: string;
    session_date: string;
    ai_duration_minutes: number;
    ai_cost_zar: number;
  }>,
  rawTimeEntries: Array<{ duration: string; start: string; user: { id: number } }>,
  clickupIdToEmail: Map<number, string>,
  displayNameByEmail: Map<string, string>,
): BreakdownSlice[] {
  // AI hours by "email::bucketKey"
  const aiByKey = new Map<string, { ai_session_hours: number; ai_cost_zar: number }>();
  for (const row of rawAiRows) {
    const bk = subBucketKey(period, row.session_date);
    const k = `${row.logged_by}::${bk}`;
    const cur = aiByKey.get(k) ?? { ai_session_hours: 0, ai_cost_zar: 0 };
    cur.ai_session_hours += Number(row.ai_duration_minutes) / 60;
    cur.ai_cost_zar += Number(row.ai_cost_zar);
    aiByKey.set(k, cur);
  }

  // Human hours by "email::bucketKey" from ClickUp entries
  const humanByKey = new Map<string, number>();
  for (const entry of rawTimeEntries) {
    const email = clickupIdToEmail.get(Number(entry.user.id));
    if (!email) continue;
    const bk = subBucketKeyFromMs(period, Number(entry.start));
    const k = `${email}::${bk}`;
    humanByKey.set(k, (humanByKey.get(k) ?? 0) + Number(entry.duration) / 3_600_000);
  }

  // Collect all bucket keys and member emails
  const allBuckets = new Set<string>();
  const allEmails = new Set<string>();
  for (const row of rawAiRows) {
    allBuckets.add(subBucketKey(period, row.session_date));
    allEmails.add(row.logged_by);
  }
  for (const entry of rawTimeEntries) {
    const email = clickupIdToEmail.get(Number(entry.user.id));
    if (email) {
      allBuckets.add(subBucketKeyFromMs(period, Number(entry.start)));
      allEmails.add(email);
    }
  }

  return Array.from(allBuckets)
    .sort()
    .map((bk) => {
      const members = Array.from(allEmails)
        .map((email): MemberRow | null => {
          const ai = aiByKey.get(`${email}::${bk}`) ?? { ai_session_hours: 0, ai_cost_zar: 0 };
          const human_hours = Math.round((humanByKey.get(`${email}::${bk}`) ?? 0) * 100) / 100;
          const ai_session_hours = Math.round(ai.ai_session_hours * 100) / 100;
          if (human_hours === 0 && ai_session_hours === 0) return null;
          const multiplier = computeMultiplier(human_hours, ai_session_hours);
          return {
            email,
            display_name: displayNameByEmail.get(email) ?? email,
            human_hours,
            ai_session_hours,
            ai_cost_zar: Math.round(ai.ai_cost_zar * 100) / 100,
            multiplier,
            effective_output_hours: Math.round(human_hours * multiplier * 100) / 100,
          };
        })
        .filter((m): m is MemberRow => m !== null);
      return { sub_key: bk, sub_label: subBucketLabel(period, bk), members };
    })
    .filter((s) => s.members.length > 0);
}

// ─── Parallel view ────────────────────────────────────────────────────────────

async function parallelView(
  sb: ReturnType<typeof createServiceRoleClient>,
  pr: { startDate: string; endDate: string; label: string },
  logged_by?: string,
) {
  const TZ_OFFSET_MS = 2 * 3600 * 1000; // SAST = UTC+2

  // Fetch AI sessions with created_at for start-time derivation
  let query = sb
    .from("ai_sessions")
    .select("ai_duration_minutes, created_at, logged_by")
    .gte("session_date", pr.startDate)
    .lt("session_date", pr.endDate)
    .eq("engagement_type", "task")
    .gte("ai_duration_minutes", 1)
    .order("created_at");

  if (logged_by) query = query.eq("logged_by", logged_by);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Fetch ClickUp config and team for human time bucketing
  const [settingsResult, teamResult] = await Promise.all([
    sb.from("settings").select("clickup_enabled, clickup_workspace_id").eq("id", 1).single(),
    sb.from("team_members").select("email, clickup_user_id").not("clickup_user_id", "is", null),
  ]);

  const clickupIdToEmail = new Map<number, string>();
  for (const tm of teamResult.data ?? []) {
    if (tm.clickup_user_id) clickupIdToEmail.set(Number(tm.clickup_user_id), tm.email);
  }

  type Cell = { ai_sessions: number; human_minutes: number };
  const heatmap: Record<string, Record<number, Cell>> = {};

  function ensureCell(dateKey: string, hour: number): Cell {
    if (!heatmap[dateKey]) heatmap[dateKey] = {};
    if (!heatmap[dateKey][hour]) heatmap[dateKey][hour] = { ai_sessions: 0, human_minutes: 0 };
    return heatmap[dateKey][hour];
  }

  function localDateHour(utcMs: number): { dateKey: string; hour: number } {
    const localMs = utcMs + TZ_OFFSET_MS;
    const d = new Date(localMs);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return { dateKey: `${y}-${mo}-${da}`, hour: d.getUTCHours() };
  }

  // Bucket AI sessions by hour
  let totalAiMinutes = 0;
  for (const row of data ?? []) {
    const durationMin = Number(row.ai_duration_minutes);
    totalAiMinutes += durationMin;
    const endMs = new Date(row.created_at as string).getTime();
    const startMs = endMs - durationMin * 60_000;
    let cursor = Math.floor(startMs / 3_600_000) * 3_600_000;
    while (cursor < endMs) {
      const { dateKey, hour } = localDateHour(cursor);
      ensureCell(dateKey, hour).ai_sessions++;
      cursor += 3_600_000;
    }
  }

  // Bucket ClickUp human time by hour
  const settings = settingsResult.data;
  if (settings?.clickup_enabled && settings?.clickup_workspace_id) {
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (clickupPat) {
      const timeParams = new URLSearchParams({
        start_date: String(new Date(pr.startDate).getTime()),
        end_date: String(new Date(pr.endDate).getTime()),
      });
      if (logged_by) {
        for (const tm of teamResult.data ?? []) {
          if (tm.email === logged_by && tm.clickup_user_id) {
            timeParams.append("assignee", String(tm.clickup_user_id));
          }
        }
      }
      const timeRes = await fetch(
        `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/time_entries?${timeParams}`,
        { headers: { Authorization: clickupPat } },
      );
      if (timeRes.ok) {
        const timeBody = await timeRes.json() as {
          data: Array<{ duration: string; start: string; user: { id: number } }>;
        };
        for (const entry of timeBody.data ?? []) {
          const email = clickupIdToEmail.get(Number(entry.user.id));
          if (!email || (logged_by && email !== logged_by)) continue;
          const { dateKey, hour } = localDateHour(Number(entry.start));
          ensureCell(dateKey, hour).human_minutes += Number(entry.duration) / 60_000;
        }
      }
    }
  }

  // Compute summary
  let peakConcurrent = 0;
  let peakHour = 9;
  let activeHours = 0;

  for (const dayData of Object.values(heatmap)) {
    for (const [hourStr, cell] of Object.entries(dayData)) {
      if (cell.ai_sessions > 0) {
        activeHours++;
        if (cell.ai_sessions > peakConcurrent) {
          peakConcurrent = cell.ai_sessions;
          peakHour = Number(hourStr);
        }
      }
    }
  }

  return json({
    periodLabel: pr.label,
    heatmap,
    summary: {
      peak_concurrent: peakConcurrent,
      peak_hour: peakHour,
      total_ai_hours: Math.round(totalAiMinutes / 60 * 10) / 10,
      wall_clock_hours: activeHours,
      active_hours: activeHours,
    },
  });
}

// ─── Passive view ─────────────────────────────────────────────────────────────

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
