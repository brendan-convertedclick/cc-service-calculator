// Allowance reader for the Scope Ledger Rail.
//
// Builds the client's coverage ledger by UNIONing two sources:
//   1. Retainer entitlements — retainer_recurring_services rows for the
//      client's active retainer project(s). allowance_qty = occurrences_per_month.
//   2. Fixed-price project membership — accepted quote_services on the client's
//      active fixed project(s). allowance_qty = qty (used as membership only in
//      V1; the pure resolver does not meter project quantities).
//
// If a service_id appears from both sources, the retainer row wins (retainers
// meter per occurrence, which is the stricter/more-informative entitlement).
//
// Type-only import of SupabaseClient keeps this importable from Deno edge
// functions; the ClientAllowance shape is defined in the pure resolver.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { ClientAllowance } from "./scope-disposition.ts";

export type { ClientAllowance };

export async function getClientAllowances(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientAllowance[]> {
  // --- Retainer source -------------------------------------------------------
  // retainer_recurring_services rrs JOIN projects p ON p.id = rrs.project_id
  // WHERE p.client_id = clientId AND p.engagement_type = 'retainer'
  //   AND p.status = 'in_progress'
  const { data: retainerRows, error: retainerErr } = await supabase
    .from("retainer_recurring_services")
    .select("service_id, occurrences_per_month, projects!inner(client_id, engagement_type, status)")
    .eq("projects.client_id", clientId)
    .eq("projects.engagement_type", "retainer")
    .eq("projects.status", "in_progress");

  if (retainerErr) {
    throw new Error(`getClientAllowances: retainer query failed: ${retainerErr.message}`);
  }

  // --- Fixed-price project source -------------------------------------------
  // quote_services qs JOIN quotes q ON q.id = qs.quote_id
  //   JOIN projects p ON p.quote_id = q.id
  // WHERE p.client_id = clientId AND p.engagement_type = 'fixed'
  //   AND p.status = 'in_progress'
  const { data: projectRows, error: projectErr } = await supabase
    .from("quote_services")
    .select("service_id, qty, quotes!inner(projects!inner(client_id, engagement_type, status))")
    .eq("quotes.projects.client_id", clientId)
    .eq("quotes.projects.engagement_type", "fixed")
    .eq("quotes.projects.status", "in_progress");

  if (projectErr) {
    throw new Error(`getClientAllowances: project query failed: ${projectErr.message}`);
  }

  // Retainer first so it wins ties; project rows only fill gaps.
  const byService = new Map<string, ClientAllowance>();

  for (const row of (retainerRows ?? []) as Array<{
    service_id: string;
    occurrences_per_month: number | null;
  }>) {
    if (!byService.has(row.service_id)) {
      byService.set(row.service_id, {
        service_id: row.service_id,
        allowance_qty: row.occurrences_per_month,
        source: "retainer",
      });
    }
  }

  for (const row of (projectRows ?? []) as Array<{
    service_id: string;
    qty: number | null;
  }>) {
    if (!byService.has(row.service_id)) {
      byService.set(row.service_id, {
        service_id: row.service_id,
        allowance_qty: row.qty,
        source: "project",
      });
    }
  }

  return [...byService.values()];
}
