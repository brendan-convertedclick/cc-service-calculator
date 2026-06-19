// supabase/functions/update-retainer-services/index.ts
//
// Request:  POST {
//   project_id,
//   services: Array<{ id?, service_id, cadence, occurrences_per_month,
//                     points_per_occurrence, default_assignees, is_live_eligible }>
// }
// Response: 200 { updated, inserted, deleted }
//
// Reconciles a retainer's recurring services after creation: UPDATE rows with an
// id, INSERT rows without one, DELETE existing rows no longer present. Changes
// apply to the NEXT provisioning cycle — the current period's already-provisioned
// ClickUp tasks are left untouched. (Deleting a recurring service cascades its
// provisioned_tasks records; the ClickUp tasks + recorded actuals remain.)
// Call provision-retainer-period afterwards to push newly-added services into the
// current month on demand ("Provision now").

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const VALID_CADENCES = ["daily", "weekly", "biweekly", "monthly", "custom"];

type ServiceInput = {
  id?: string;
  service_id: string;
  cadence: string;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { project_id, services } = (await req.json()) as {
      project_id?: string;
      services?: ServiceInput[];
    };
    if (!project_id) return json({ error: "project_id required" }, 400);
    if (!Array.isArray(services) || services.length < 1) {
      return json({ error: "At least one recurring service is required" }, 400);
    }
    for (const [i, svc] of services.entries()) {
      if (!svc.service_id) return json({ error: `services[${i}]: service_id required` }, 400);
      if (!VALID_CADENCES.includes(svc.cadence)) {
        return json({ error: `services[${i}]: cadence must be one of ${VALID_CADENCES.join(", ")}` }, 400);
      }
      if (typeof svc.occurrences_per_month !== "number" || !(svc.occurrences_per_month > 0)) {
        return json({ error: `services[${i}]: occurrences_per_month must be > 0` }, 400);
      }
      if (typeof svc.points_per_occurrence !== "number" || !(svc.points_per_occurrence > 0)) {
        return json({ error: `services[${i}]: points_per_occurrence must be > 0` }, 400);
      }
      if (!Array.isArray(svc.default_assignees) || svc.default_assignees.length < 1) {
        return json({ error: `services[${i}]: at least one default assignee is required` }, 400);
      }
    }

    const sb = createServiceRoleClient();

    const { data: project, error: pErr } = await sb
      .from("projects").select("id, engagement_type").eq("id", project_id).single();
    if (pErr || !project) return json({ error: pErr?.message ?? "Project not found" }, 404);
    if (project.engagement_type !== "retainer") {
      return json({ error: "Project is not a retainer" }, 400);
    }

    const { data: existingRows, error: exErr } = await sb
      .from("retainer_recurring_services").select("id").eq("project_id", project_id);
    if (exErr) return json({ error: exErr.message }, 500);
    const existingIds = new Set((existingRows ?? []).map((r) => r.id as string));
    const keptIds = new Set(services.filter((s) => s.id).map((s) => s.id as string));

    let updated = 0;
    let inserted = 0;
    let deleted = 0;

    const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
    if (toDelete.length > 0) {
      const { error } = await sb.from("retainer_recurring_services").delete().in("id", toDelete);
      if (error) return json({ error: error.message }, 500);
      deleted = toDelete.length;
    }

    for (const svc of services) {
      const row = {
        service_id: svc.service_id,
        cadence: svc.cadence,
        occurrences_per_month: svc.occurrences_per_month,
        points_per_occurrence: svc.points_per_occurrence,
        default_assignees: svc.default_assignees,
        is_live_eligible: svc.is_live_eligible,
      };
      if (svc.id && existingIds.has(svc.id)) {
        const { error } = await sb.from("retainer_recurring_services").update(row).eq("id", svc.id);
        if (error) return json({ error: error.message }, 500);
        updated += 1;
      } else {
        const { error } = await sb.from("retainer_recurring_services").insert({ ...row, project_id });
        if (error) return json({ error: error.message }, 500);
        inserted += 1;
      }
    }

    return json({ updated, inserted, deleted });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
