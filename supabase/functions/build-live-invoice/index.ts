// supabase/functions/build-live-invoice/index.ts
//
// Build draft Xero line items for a client's billable live-task hours
// over a period. Reads live_actuals_by_period (which already filters to
// billable=true) and multiplies hours by the assignee's primary
// department rate. Returns line items — does NOT push to Xero. Push is
// owned by push-to-xero; this function is the rollup source.
//
// Request: POST { client_id, period_start, period_end } (ISO dates)
// Response: { client_id, period_start, period_end, lines: [...], total_cents, warnings: [...] }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type Body = { client_id: string; period_start: string; period_end: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { client_id, period_start, period_end } = (await req.json()) as Body;
    if (!client_id || !period_start || !period_end) {
      return json({ error: "client_id, period_start, period_end required" }, 400);
    }

    const supabase = createServiceRoleClient();

    const { data: rows, error: rowsErr } = await supabase
      .from("live_actuals_by_period")
      .select("team_member_id, department_id, hours, entry_start")
      .eq("client_id", client_id)
      .gte("entry_start", period_start)
      .lt("entry_start", period_end);
    if (rowsErr) return json({ error: rowsErr.message }, 500);

    const memberIds = [...new Set((rows ?? []).map((r) => r.team_member_id))];
    const deptIds = [...new Set((rows ?? []).map((r) => r.department_id).filter(Boolean))];

    const [{ data: members }, { data: depts }] = await Promise.all([
      memberIds.length
        ? supabase.from("team_members").select("id, full_name, primary_department_id").in("id", memberIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; primary_department_id: string | null }> }),
      deptIds.length
        ? supabase.from("departments").select("id, name, hourly_rate_cents").in("id", deptIds as string[])
        : Promise.resolve({ data: [] as Array<{ id: string; name: string; hourly_rate_cents: number | null }> }),
    ]);

    const memberById = new Map((members ?? []).map((m) => [m.id, m]));
    const deptById = new Map((depts ?? []).map((d) => [d.id, d]));

    // Group hours by (member, department) so each line is one labelled row.
    const grouped = new Map<string, { member_id: string; department_id: string; hours: number }>();
    for (const r of rows ?? []) {
      if (!r.department_id) continue; // member with no primary department: dropped, surfaced in warnings below
      const key = `${r.team_member_id}::${r.department_id}`;
      const existing = grouped.get(key);
      if (existing) existing.hours += Number(r.hours);
      else grouped.set(key, { member_id: r.team_member_id, department_id: r.department_id, hours: Number(r.hours) });
    }

    const lines: Array<{ description: string; quantity: number; unit_amount_cents: number; amount_cents: number }> = [];
    const warnings: string[] = [];
    let total_cents = 0;
    for (const g of grouped.values()) {
      const member = memberById.get(g.member_id);
      const dept = deptById.get(g.department_id);
      if (!member || !dept) {
        const dropHours = Math.round(g.hours * 100) / 100;
        warnings.push(
          !member
            ? `Dropped ${dropHours.toFixed(2)}h — team member ${g.member_id} not found`
            : `Dropped ${dropHours.toFixed(2)}h — department ${g.department_id} not found`,
        );
        continue;
      }
      const rate = dept.hourly_rate_cents ?? 0;
      const hours = Math.round(g.hours * 100) / 100;
      const amount_cents = Math.round(hours * rate);
      total_cents += amount_cents;
      lines.push({
        description: `${dept.name} — ${member.full_name}`,
        quantity: hours,
        unit_amount_cents: rate,
        amount_cents,
      });
    }

    const dropped = (rows ?? [])
      .filter((r) => !r.department_id)
      .reduce((s, r) => s + Number(r.hours), 0);
    if (dropped > 0) {
      warnings.push(`${dropped.toFixed(2)} billable hours dropped — assignee has no primary_department_id`);
    }

    return json({
      client_id,
      period_start,
      period_end,
      lines,
      total_cents,
      warnings,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
