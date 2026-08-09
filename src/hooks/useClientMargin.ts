import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ClientMarginRow = {
  clientId: string;
  clientName: string;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
  targetPct: number;
  rag: "green" | "amber" | "red";
};

export type XeroConnectionStatus = {
  connected: boolean;
  lastSyncedAt: string | null;
};

/** Returns Xero connection status (whether any xero_connection row exists). */
export function useXeroConnectionStatus() {
  return useQuery<XeroConnectionStatus>({
    queryKey: ["xeroConnectionStatus"],
    queryFn: async () => {
      const { data } = await supabase
        .from("xero_connection")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        connected: !!data,
        lastSyncedAt: (data as { updated_at?: string } | null)?.updated_at ?? null,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Returns whether any xero_invoices rows exist. */
function useHasInvoices() {
  return useQuery<boolean>({
    queryKey: ["xeroHasInvoices"],
    queryFn: async () => {
      const { count } = await supabase
        .from("xero_invoices")
        .select("id", { count: "exact", head: true });
      return (count ?? 0) > 0;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Returns per-client margin data for the rolling 30 days.
 *
 * cost_cents:    sum of project_actuals_current rows for this client's projects
 *                (uses departments.cost_rate_cents * actual_hours — falls back to
 *                hourly_rate_cents if cost_rate not set)
 * revenue_cents: sum of xero_invoices.amount_cents where paid_at in rolling 30 days
 * margin_cents:  revenue_cents - cost_cents
 * margin_pct:    margin_cents / revenue_cents * 100  (null if revenue_cents = 0)
 * target_pct:    clients.margin_target_pct (default 40)
 * rag:           green if margin_pct >= target, amber if within 5pp below, red if >5pp below
 */
export function useClientMargin() {
  const connectionStatus = useXeroConnectionStatus();
  const hasInvoices = useHasInvoices();

  const query = useQuery<ClientMarginRow[]>({
    queryKey: ["clientMargin"],
    enabled: connectionStatus.data?.connected === true && hasInvoices.data === true,
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoff = thirtyDaysAgo.toISOString();

      // Fetch all active clients with margin target
      const { data: clients, error: cErr } = await supabase
        .from("clients")
        .select("id, name, margin_target_pct")
        .is("archived_at", null)
        .order("name");
      if (cErr) throw cErr;

      // Fetch xero invoices paid in last 30 days (by client_id)
      const { data: invoices, error: iErr } = await supabase
        .from("xero_invoices")
        .select("client_id, amount_cents, paid_at")
        .eq("status", "PAID")
        .gte("paid_at", cutoff);
      if (iErr) throw iErr;

      // Revenue by client
      const revenueByClient = new Map<string, number>();
      for (const inv of invoices ?? []) {
        if (!inv.client_id) continue;
        revenueByClient.set(
          inv.client_id,
          (revenueByClient.get(inv.client_id) ?? 0) + (inv.amount_cents ?? 0),
        );
      }

      // Fetch projects for clients (in_progress only)
      const { data: projects, error: pErr } = await supabase
        .from("projects")
        .select("id, client_id")
        .eq("status", "in_progress")
        .not("client_id", "is", null);
      if (pErr) throw pErr;

      const projectIds = (projects ?? []).map((p) => p.id);
      const projectClientMap = new Map(
        (projects ?? []).map((p) => [p.id, p.client_id as string]),
      );

      // Fetch actuals for those projects in the last 30 days
      const costByClient = new Map<string, number>();
      if (projectIds.length > 0) {
        const { data: actuals, error: aErr } = await supabase
          .from("project_actuals_current")
          .select("project_id, actual_hours, dept_id")
          .in("project_id", projectIds)
          .gte("recorded_at", cutoff);
        if (aErr) throw aErr;

        // Fetch department cost rates
        const { data: depts } = await supabase
          .from("departments")
          .select("id, cost_rate_cents, hourly_rate_cents");

        const deptCostRate = new Map(
          (depts ?? []).map((d) => [
            d.id,
            (d.cost_rate_cents ?? d.hourly_rate_cents ?? 0) as number,
          ]),
        );

        for (const actual of actuals ?? []) {
          const clientId = projectClientMap.get(actual.project_id);
          if (!clientId) continue;
          const rate = actual.dept_id ? (deptCostRate.get(actual.dept_id) ?? 0) : 0;
          const costCents = Math.round((actual.actual_hours ?? 0) * rate);
          costByClient.set(clientId, (costByClient.get(clientId) ?? 0) + costCents);
        }
      }

      // Build result rows — only include clients with revenue or cost data
      const rows: ClientMarginRow[] = [];
      for (const client of clients ?? []) {
        const revenueCents = revenueByClient.get(client.id) ?? 0;
        const costCents = costByClient.get(client.id) ?? 0;
        if (revenueCents === 0 && costCents === 0) continue;

        const marginCents = revenueCents - costCents;
        const marginPct = revenueCents > 0 ? (marginCents / revenueCents) * 100 : null;
        const targetPct = Number(client.margin_target_pct ?? 40);

        let rag: "green" | "amber" | "red" = "green";
        if (marginPct === null) {
          rag = "red";
        } else if (marginPct >= targetPct) {
          rag = "green";
        } else if (marginPct >= targetPct - 5) {
          rag = "amber";
        } else {
          rag = "red";
        }

        rows.push({
          clientId: client.id,
          clientName: client.name,
          revenueCents,
          costCents,
          marginCents,
          marginPct,
          targetPct,
          rag,
        });
      }

      return rows.sort((a, b) => a.clientName.localeCompare(b.clientName));
    },
    staleTime: 10 * 60 * 1000,
  });

  return {
    ...query,
    connectionStatus: connectionStatus.data,
    hasInvoices: hasInvoices.data,
    isLoadingConnection: connectionStatus.isLoading,
  };
}
