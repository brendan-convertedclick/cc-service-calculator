import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ReconciliationRow {
  clientId: string;
  clientName: string;
  // Delivery side
  deliveredHours: number;
  costCents: number;
  // Invoice side
  invoicedCents: number;
  invoiceStatus: string | null; // worst status: OVERDUE > AUTHORISED > PAID > null
  overdueInvoices: number;
  uninvoicedWork: boolean;
  // Flags
  flags: Array<"work_not_invoiced" | "invoice_overdue" | "no_actuals">;
  // Detail — for drawer
  invoices: Array<{
    id: string;
    invoiceNumber: string | null;
    status: string;
    amountCents: number;
    dueDate: string | null;
    paidAt: string | null;
    xeroInvoiceId: string;
  }>;
}

function monthRange(year: number, month: number): { start: string; end: string } {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

// Status priority: lower number = worse / more urgent
const STATUS_PRIORITY: Record<string, number> = {
  OVERDUE: 0,
  AUTHORISED: 1,
  SUBMITTED: 2,
  DRAFT: 3,
  PAID: 4,
  VOIDED: 5,
};

function worstStatus(statuses: string[], today: string): string | null {
  if (statuses.length === 0) return null;
  // Inject "OVERDUE" as a virtual status for past-due AUTHORISED/SUBMITTED invoices
  const resolved = statuses.map((s) => s); // copy
  return resolved.sort((a, b) => (STATUS_PRIORITY[a] ?? 99) - (STATUS_PRIORITY[b] ?? 99))[0];
}

export function useReconciliation(year: number, month: number) {
  return useQuery<ReconciliationRow[]>({
    queryKey: ["reconciliation", year, month],
    queryFn: async () => {
      const { start, end } = monthRange(year, month);
      const today = new Date().toISOString().slice(0, 10);

      // 1. Actuals for the month — group by client via project
      const { data: actuals, error: actualsError } = await supabase
        .from("project_actuals_current")
        .select("project_id, actual_hours, cost_cents, recorded_at")
        .gte("recorded_at", start)
        .lt("recorded_at", end);

      if (actualsError) throw actualsError;

      // 2. Projects to resolve client_id
      const { data: projects, error: projectsError } = await supabase
        .from("projects")
        .select("id, client_id, name");

      if (projectsError) throw projectsError;

      // 3. Clients
      const { data: clients, error: clientsError } = await supabase
        .from("clients")
        .select("id, name");

      if (clientsError) throw clientsError;

      // 4. Xero invoices for the month (by created_at in month)
      // Gracefully handle if table doesn't exist yet
      let invoiceRows: Array<{
        id: string;
        client_id: string | null;
        status: string;
        amount_cents: number;
        due_date: string | null;
        paid_at: string | null;
        invoice_number: string | null;
        xero_invoice_id: string;
        created_at: string;
      }> = [];

      try {
        const { data: invoices, error: invoicesError } = await supabase
          .from("xero_invoices")
          .select(
            "id, client_id, status, amount_cents, due_date, paid_at, invoice_number, xero_invoice_id, created_at"
          )
          .gte("created_at", start)
          .lt("created_at", end);

        if (!invoicesError && invoices) {
          invoiceRows = invoices;
        }
      } catch {
        // table may not exist — continue with empty
      }

      // Build lookup maps
      const projectMap = new Map(projects?.map((p) => [p.id, p]) ?? []);
      const clientMap = new Map(clients?.map((c) => [c.id, c]) ?? []);

      // Aggregate actuals by client
      const actualsByClient = new Map<string, { hours: number; costCents: number }>();
      for (const a of actuals ?? []) {
        const proj = projectMap.get(a.project_id ?? "");
        if (!proj?.client_id) continue;
        const existing = actualsByClient.get(proj.client_id) ?? { hours: 0, costCents: 0 };
        existing.hours += a.actual_hours ?? 0;
        existing.costCents += a.cost_cents ?? 0;
        actualsByClient.set(proj.client_id, existing);
      }

      // Aggregate invoices by client
      const invoicesByClient = new Map<
        string,
        typeof invoiceRows
      >();
      for (const inv of invoiceRows) {
        if (!inv.client_id) continue;
        const list = invoicesByClient.get(inv.client_id) ?? [];
        list.push(inv);
        invoicesByClient.set(inv.client_id, list);
      }

      // Collect all client IDs that appear in either dataset
      const allClientIds = new Set<string>([
        ...actualsByClient.keys(),
        ...invoicesByClient.keys(),
      ]);

      const rows: ReconciliationRow[] = [];

      for (const clientId of allClientIds) {
        const client = clientMap.get(clientId);
        if (!client) continue;

        const agg = actualsByClient.get(clientId) ?? { hours: 0, costCents: 0 };
        const invList = invoicesByClient.get(clientId) ?? [];

        const invoicedCents = invList.reduce((s, i) => s + (i.amount_cents ?? 0), 0);

        // Overdue = due_date < today AND status not PAID/VOIDED
        const overdueCount = invList.filter(
          (i) =>
            i.due_date &&
            i.due_date < today &&
            i.status !== "PAID" &&
            i.status !== "VOIDED"
        ).length;

        // Build resolved statuses (inject OVERDUE for past-due unpaid invoices)
        const resolvedStatuses = invList.map((i) => {
          if (
            i.due_date &&
            i.due_date < today &&
            i.status !== "PAID" &&
            i.status !== "VOIDED"
          ) {
            return "OVERDUE";
          }
          return i.status;
        });

        const worst = worstStatus(resolvedStatuses, today);

        const uninvoicedWork = agg.costCents > 0 && invList.length === 0;

        const flags: ReconciliationRow["flags"] = [];
        if (uninvoicedWork) flags.push("work_not_invoiced");
        if (overdueCount > 0) flags.push("invoice_overdue");
        if (invList.length > 0 && agg.hours === 0) flags.push("no_actuals");

        rows.push({
          clientId,
          clientName: client.name,
          deliveredHours: Math.round(agg.hours * 10) / 10,
          costCents: agg.costCents,
          invoicedCents,
          invoiceStatus: worst,
          overdueInvoices: overdueCount,
          uninvoicedWork,
          flags,
          invoices: invList.map((i) => ({
            id: i.id,
            invoiceNumber: i.invoice_number,
            status: resolvedStatuses[invList.indexOf(i)],
            amountCents: i.amount_cents,
            dueDate: i.due_date,
            paidAt: i.paid_at,
            xeroInvoiceId: i.xero_invoice_id,
          })),
        });
      }

      // Sort: overdue first, then by client name
      rows.sort((a, b) => {
        const aOverdue = a.flags.includes("invoice_overdue") ? 0 : 1;
        const bOverdue = b.flags.includes("invoice_overdue") ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        return a.clientName.localeCompare(b.clientName);
      });

      return rows;
    },
    staleTime: 5 * 60 * 1000,
  });
}
