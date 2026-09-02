// Three numbers per retainer, per month — because one number could never do
// the job:
//
//   Sold      what the monthly fee buys at the standard rate. A pricing fact.
//   Committed the recurring work scheduled against it. A delivery promise.
//   Delivered  what actually got briefed and done. What happened.
//
// Sold vs Committed says whether we are giving away margin or under-servicing.
// Committed vs Delivered says whether the month happened. Conductor previously
// showed only hours logged against provisioned tasks, which missed every brief
// and read as 19% on a book that was mostly being delivered.
//
// Delivered counts POINTS, not logged time: points are on 98% of briefs and
// need nobody to run a timer. 1 point = 15 minutes (see CLAUDE.md).
//
// A month earns work when the work CLOSED in it, not when it was raised. A
// brief opened in July and finished in August is August's delivery. Only
// briefs with completed_at count — which is exactly the set whose ClickUp task
// reads closed, so work still in flight is reported separately rather than
// counted early.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const HOURS_PER_POINT = 0.25;

/** Work that belongs to no retainer, split by what it is. */
export type AllocationKind = "retainer" | "fixed" | "adhoc" | "internal";

export interface AllocationRow {
  key: string;
  kind: AllocationKind;
  clientName: string;
  /** Retainer name, or the client name for adhoc/internal groupings. */
  name: string;
  projectId: string | null;
  feeCents: number;
  soldHours: number;
  committedHours: number;
  deliveredHours: number;
  deliveredPoints: number;
  briefCount: number;
  /** Our own work rather than a paying client's (clients.is_internal, 0152). */
  isInternal: boolean;
  /** Points raised against this row and not yet closed. A "now" figure, so it
   *  is only meaningful on the current month. */
  openPoints: number;
}

export interface AllocationMonth {
  month: string;
  rows: AllocationRow[];
}

interface ProjectRow {
  id: string;
  name: string;
  client_id: string;
  status: string;
  engagement_type: string;
  retainer_hours_target: number | null;
  retainer_monthly_fee_cents: number | null;
  clients: { name: string } | null;
}

interface BriefRow {
  parent_project_id: string | null;
  client_id: string | null;
  billing_type: string | null;
  original_points: number | null;
  created_at: string;
  completed_at: string | null;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function useRetainerAllocation(monthsBack = 6) {
  return useQuery({
    queryKey: ["retainer_allocation", monthsBack],
    queryFn: async (): Promise<AllocationMonth[]> => {
      const since = new Date();
      since.setMonth(since.getMonth() - monthsBack);
      const sinceIso = since.toISOString();

      const [projectsRes, servicesRes, briefsRes, clientsRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, client_id, status, engagement_type, retainer_hours_target, retainer_monthly_fee_cents, clients(name)")
          .in("engagement_type", ["retainer", "fixed"])
          .neq("status", "archived"),
        supabase
          .from("retainer_recurring_services")
          .select("project_id, occurrences_per_month, points_per_occurrence"),
        supabase
          .from("briefs")
          .select("parent_project_id, client_id, billing_type, original_points, created_at, completed_at")
          .or(`completed_at.gte.${sinceIso},completed_at.is.null`)
          .in("status", ["briefed", "accepted", "quoted", "scoped"]),
        // Read from the clients table, not from the projects join: a client
        // with adhoc work and no project of their own would otherwise resolve
        // to "Unknown client". is_internal (0152) replaced a hardcoded list of
        // six names that was missing two of our own brands.
        supabase.from("clients").select("id, name, is_internal"),
      ]);
      if (projectsRes.error) throw projectsRes.error;
      if (servicesRes.error) throw servicesRes.error;
      if (briefsRes.error) throw briefsRes.error;
      if (clientsRes.error) throw clientsRes.error;

      const projects = (projectsRes.data ?? []) as unknown as ProjectRow[];
      const briefs = (briefsRes.data ?? []) as unknown as BriefRow[];

      const committedPoints = new Map<string, number>();
      for (const s of (servicesRes.data ?? []) as Array<{
        project_id: string;
        occurrences_per_month: number | null;
        points_per_occurrence: number | null;
      }>) {
        const pts = Number(s.occurrences_per_month ?? 0) * Number(s.points_per_occurrence ?? 0);
        committedPoints.set(s.project_id, (committedPoints.get(s.project_id) ?? 0) + pts);
      }

      const clientRows = (clientsRes.data ?? []) as Array<{ id: string; name: string; is_internal: boolean }>;
      const clientNameById = new Map(clientRows.map((c) => [c.id, c.name]));
      const internalClientIds = new Set(clientRows.filter((c) => c.is_internal).map((c) => c.id));

      // Months are the months work CLOSED in, newest first.
      const closed = briefs.filter((b) => b.completed_at != null);
      const months = [...new Set(closed.map((b) => monthKey(b.completed_at!)))].sort().reverse();
      const currentMonth = monthKey(new Date().toISOString());
      if (!months.includes(currentMonth)) months.unshift(currentMonth);

      // Still open: counted once, against whatever it is booked to.
      const openByProject = new Map<string, number>();
      const openByClient = new Map<string, number>();
      for (const b of briefs) {
        if (b.completed_at) continue;
        const pts = Number(b.original_points ?? 0);
        if (b.parent_project_id) {
          openByProject.set(b.parent_project_id, (openByProject.get(b.parent_project_id) ?? 0) + pts);
        } else if (b.client_id) {
          openByClient.set(b.client_id, (openByClient.get(b.client_id) ?? 0) + pts);
        }
      }

      return months.map((month) => {
        const isCurrent = month === currentMonth;
        const inMonth = closed.filter((b) => monthKey(b.completed_at!) === month);

        const deliveredByProject = new Map<string, { points: number; count: number }>();
        const otherByKey = new Map<string, { points: number; count: number; clientId: string }>();

        for (const b of inMonth) {
          const pts = Number(b.original_points ?? 0);
          if (b.parent_project_id) {
            const cur = deliveredByProject.get(b.parent_project_id) ?? { points: 0, count: 0 };
            deliveredByProject.set(b.parent_project_id, { points: cur.points + pts, count: cur.count + 1 });
          } else if (b.client_id) {
            const cur = otherByKey.get(b.client_id) ?? { points: 0, count: 0, clientId: b.client_id };
            otherByKey.set(b.client_id, { ...cur, points: cur.points + pts, count: cur.count + 1 });
          }
        }

        const rows: AllocationRow[] = projects
          .filter((p) => p.status !== "completed" || deliveredByProject.has(p.id))
          .map((p) => {
            const d = deliveredByProject.get(p.id) ?? { points: 0, count: 0 };
            return {
              key: p.id,
              // Fixed-price work carries no value or hours budget in Conductor —
              // there are no columns for it — so those rows show delivery only.
              kind: (p.engagement_type === "fixed" ? "fixed" : "retainer") as AllocationKind,
              clientName: p.clients?.name ?? "Unknown",
              name: p.name,
              projectId: p.id,
              feeCents: p.retainer_monthly_fee_cents ?? 0,
              soldHours: Number(p.retainer_hours_target ?? 0),
              committedHours: (committedPoints.get(p.id) ?? 0) * HOURS_PER_POINT,
              deliveredHours: d.points * HOURS_PER_POINT,
              deliveredPoints: d.points,
              briefCount: d.count,
              isInternal: internalClientIds.has(p.client_id),
              openPoints: isCurrent ? openByProject.get(p.id) ?? 0 : 0,
            };
          });

        if (isCurrent) {
          for (const [clientId, pts] of openByClient) {
            if (!otherByKey.has(clientId) && pts > 0) {
              otherByKey.set(clientId, { points: 0, count: 0, clientId });
            }
          }
        }

        for (const [clientId, v] of otherByKey) {
          const clientName = clientNameById.get(clientId) ?? "Unknown client";
          const isInternal = internalClientIds.has(clientId);
          const kind: AllocationKind = isInternal ? "internal" : "adhoc";
          rows.push({
            key: `${kind}:${clientId}`,
            kind,
            clientName,
            name: kind === "adhoc" ? "Adhoc — to invoice" : "Internal work",
            projectId: null,
            feeCents: 0,
            soldHours: 0,
            committedHours: 0,
            deliveredHours: v.points * HOURS_PER_POINT,
            deliveredPoints: v.points,
            briefCount: v.count,
            isInternal,
            openPoints: isCurrent ? openByClient.get(clientId) ?? 0 : 0,
          });
        }

        return { month, rows };
      });
    },
  });
}

/** How delivery compares with what was promised. Null when nothing was promised. */
export function deliveryRatio(row: AllocationRow): number | null {
  const basis = row.committedHours || row.soldHours;
  if (!basis) return null;
  return row.deliveredHours / basis;
}
