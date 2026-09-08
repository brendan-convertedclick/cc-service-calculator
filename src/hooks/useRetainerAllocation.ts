// Three numbers per retainer, per month — because one number could never do
// the job. The page calls them Planned, Scheduled and Completed; the fields
// keep their original names:
//
//   soldHours      PLANNED — what the monthly fee buys at the standard rate.
//                  A pricing fact.
//   committedHours SCHEDULED — recurring tasks set up to repeat each month.
//                  Work briefed ad hoc is real work and is not in here.
//   deliveredHours COMPLETED — what actually got briefed and closed.
//
// Planned vs Completed is the judgement: are we servicing the fee. Scheduled
// sits between them as a setup fact, NOT as a promise — reading it as one is
// what made Kings College look like a red flag at 2.3h when 11.25h had been
// completed against 22.8h planned. Conductor previously
// showed only hours logged against provisioned tasks, which missed every brief
// and read as 19% on a book that was mostly being delivered.
//
// COMPLETED counts two halves and one hour per item (Lisa, 2026-09-08):
//
//   briefs     work someone raised, closed in the month.
//   recurring  the tasks the provisioner puts into ClickUp every month — the
//              reports, the plugin sweeps, the standing meetings. These used
//              to count for NOTHING, which is why a retainer whose whole shape
//              is recurring work read as unserviced however well it was run:
//              Dovetail's SEO retainer closed six of them in August against
//              7.08h planned and the page said 0h.
//
// The two sets never overlap — a provisioned task is not a brief, verified
// across all 494 provisioned ids — so they add rather than needing a merge.
//
// Each item is worth its LOGGED time when we have it and its estimate when we
// do not. Delivery used to be estimate-only, on the argument that points are
// on 98% of briefs and need nobody to run a timer. That is still the fallback
// and still the reason there is one, but it is no longer the whole story: 83
// of August's 130 client briefs carry actual_hours, and where logged the time
// runs slightly ABOVE the estimate (Pimms 4.9h against 3.0h). Reporting the
// estimate when the real figure is sitting in the next column is a choice to
// be wrong. `measuredHours` carries how much of the total is real so the page
// can say which it is showing rather than quietly mixing them.
//
// 1 point = 15 minutes (see CLAUDE.md).
//
// A month earns work when the work CLOSED in it, not when it was raised. A
// brief opened in July and finished in August is August's delivery. Only
// briefs with completed_at count — which is exactly the set whose ClickUp task
// reads closed, so work still in flight is reported separately rather than
// counted early. A recurring task earns the month it was PROVISIONED for, not
// the month it was synced in: that is the month whose fee paid for it.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const HOURS_PER_POINT = 0.25;

// Lisa, 2026-09-02: "Split every line item into three categories: Retainer,
// Ad Hoc (anything charged outside the retainer), and Internal (unbilled, cost
// absorbed by you)" — and Internal means our own brands, kept apart from client
// work. A brief lands in exactly one of them, so nothing is counted twice:
//
//   internal  the client is one of our brands (clients.is_internal, 0152),
//             whatever the brief says. Our own work is never billed.
//   adhoc     billing_type = 'adhoc'. Charged outside the retainer.
//   retainer  billing_type = 'retainer', against a retainer with a budget.
//   unlinked  billing_type = 'retainer' but hanging off no budgeted retainer —
//             34 of August's 89.75 retainer hours. Real work with nothing to
//             measure it against, which is worth seeing rather than hiding
//             inside a client total.
//
// 'fixed' is the engagement type of a fixed-price project, not a billing
// category — those rows carry delivery only.
export type AllocationKind = "retainer" | "fixed" | "adhoc" | "internal" | "unlinked";

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
  /** The part of deliveredHours that is real logged time rather than an
   *  estimate. Equal to deliveredHours means everything on the row is measured;
   *  0 means none of it is. */
  measuredHours: number;
  /** Items behind deliveredHours, and how many of them had time logged. */
  deliveredItems: number;
  measuredItems: number;
  /** The recurring (provisioned-task) share of deliveredHours. Briefs are the
   *  rest. Kept apart because a retainer serviced entirely by standing tasks
   *  and one serviced entirely by briefs are different animals. */
  recurringHours: number;
  deliveredPoints: number;
  briefCount: number;
  /** Our own work rather than a paying client's — the client being one of our
   *  brands (clients.is_internal, 0152) or this one retainer being flagged
   *  (projects.is_internal, 0162). */
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
  /** This retainer alone is our cost, whatever the client is (0162). */
  is_internal: boolean | null;
  clients: { name: string } | null;
}

interface BriefRow {
  parent_project_id: string | null;
  client_id: string | null;
  billing_type: string | null;
  original_points: number | null;
  actual_hours: number | null;
  created_at: string;
  completed_at: string | null;
}

interface RecurringRow {
  project_id: string;
  month: string;
  is_closed: boolean;
  actual_hours: number | null;
  planned_hours: number | null;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** What one finished item contributed. Real time when we have it, the estimate
 *  when we do not — and `measured` says which, so a total built from a mix can
 *  still be honest about the mix. A zero on actual_hours is "nobody logged it",
 *  not "it took no time": ClickUp writes 0 for an untouched timer. */
export function hoursOf(
  actual: number | null | undefined,
  estimate: number,
): { hours: number; measured: boolean } {
  const logged = Number(actual ?? 0);
  return logged > 0 ? { hours: logged, measured: true } : { hours: estimate, measured: false };
}

/** Running total of delivered work, so briefs and recurring tasks accumulate
 *  through one rule instead of two copies of it. */
interface Delivery {
  hours: number;
  measuredHours: number;
  items: number;
  measuredItems: number;
  recurringHours: number;
  points: number;
  briefs: number;
}

const emptyDelivery = (): Delivery => ({
  hours: 0,
  measuredHours: 0,
  items: 0,
  measuredItems: 0,
  recurringHours: 0,
  points: 0,
  briefs: 0,
});

function addToDelivery(
  d: Delivery,
  actual: number | null | undefined,
  estimate: number,
  kind: "brief" | "recurring",
): Delivery {
  const { hours, measured } = hoursOf(actual, estimate);
  return {
    hours: d.hours + hours,
    measuredHours: d.measuredHours + (measured ? hours : 0),
    items: d.items + 1,
    measuredItems: d.measuredItems + (measured ? 1 : 0),
    recurringHours: d.recurringHours + (kind === "recurring" ? hours : 0),
    points: d.points + (kind === "brief" ? estimate / HOURS_PER_POINT : 0),
    briefs: d.briefs + (kind === "brief" ? 1 : 0),
  };
}

export function useRetainerAllocation(monthsBack = 6) {
  return useQuery({
    queryKey: ["retainer_allocation", monthsBack],
    queryFn: async (): Promise<AllocationMonth[]> => {
      const since = new Date();
      since.setMonth(since.getMonth() - monthsBack);
      const sinceIso = since.toISOString();

      const sinceMonth = monthKey(sinceIso);

      const [projectsRes, servicesRes, briefsRes, clientsRes, recurringRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, client_id, status, engagement_type, retainer_hours_target, retainer_monthly_fee_cents, is_internal, clients(name)")
          .in("engagement_type", ["retainer", "fixed"])
          .neq("status", "archived"),
        supabase
          .from("retainer_recurring_services")
          .select("project_id, occurrences_per_month, points_per_occurrence"),
        supabase
          .from("briefs")
          .select("parent_project_id, client_id, billing_type, original_points, actual_hours, created_at, completed_at")
          .or(`completed_at.gte.${sinceIso},completed_at.is.null`)
          .in("status", ["briefed", "accepted", "quoted", "scoped"]),
        // Read from the clients table, not from the projects join: a client
        // with adhoc work and no project of their own would otherwise resolve
        // to "Unknown client". is_internal (0152) replaced a hardcoded list of
        // six names that was missing two of our own brands.
        supabase.from("clients").select("id, name, is_internal"),
        // The recurring half (0160). The unnest-and-join lives in the view, so
        // there is one definition of "this provisioned task is closed" rather
        // than a second copy of it here.
        supabase
          .from("retainer_recurring_delivery")
          .select("project_id, month, is_closed, actual_hours, planned_hours")
          .gte("month", sinceMonth),
      ]);
      if (projectsRes.error) throw projectsRes.error;
      if (servicesRes.error) throw servicesRes.error;
      if (briefsRes.error) throw briefsRes.error;
      if (clientsRes.error) throw clientsRes.error;
      if (recurringRes.error) throw recurringRes.error;

      const projects = (projectsRes.data ?? []) as unknown as ProjectRow[];
      const briefs = (briefsRes.data ?? []) as unknown as BriefRow[];

      // A retainer with neither a fee nor an hours target is the "open" shape
      // Lisa described — Trellidor's ad hoc retainer: no budget, invoiced for
      // whatever the month held. Its work is ad hoc and is counted there, so it
      // is not a budgeted retainer for the purposes of this split.
      const projectsWithOwnRow = new Set(
        projects
          .filter(
            (p) =>
              p.engagement_type === "fixed" ||
              p.retainer_monthly_fee_cents != null ||
              p.retainer_hours_target != null,
          )
          .map((p) => p.id),
      );

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

      // Only closed recurring tasks are delivery. An open one is scheduled
      // work that has not happened — the Scheduled column's business, not this
      // one's.
      const recurringClosed = ((recurringRes.data ?? []) as unknown as RecurringRow[]).filter(
        (r) => r.is_closed,
      );

      // Months are the months work CLOSED in, newest first. A retainer serviced
      // entirely by standing tasks closes no briefs at all, so its months have
      // to come from the recurring side too or they never appear.
      const closed = briefs.filter((b) => b.completed_at != null);
      const months = [
        ...new Set([
          ...closed.map((b) => monthKey(b.completed_at!)),
          ...recurringClosed.map((r) => r.month),
        ]),
      ]
        .sort()
        .reverse();
      const currentMonth = monthKey(new Date().toISOString());
      if (!months.includes(currentMonth)) months.unshift(currentMonth);

      // Which of the three categories a brief's hours belong to. Exactly one,
      // decided in this order, so no hour is counted twice.
      type Bucket =
        | { kind: "project"; projectId: string }
        | { kind: AllocationKind; clientId: string };
      const bucketOf = (b: BriefRow): Bucket | null => {
        // Our own brands first: internal is about whose work it is, not how it
        // was booked, so it wins over anything the brief says.
        if (b.client_id && internalClientIds.has(b.client_id)) {
          return { kind: "internal", clientId: b.client_id };
        }
        if (
          b.parent_project_id &&
          projectsWithOwnRow.has(b.parent_project_id) &&
          b.billing_type !== "adhoc"
        ) {
          return { kind: "project", projectId: b.parent_project_id };
        }
        if (!b.client_id) return null;
        return {
          kind: b.billing_type === "adhoc" ? "adhoc" : "unlinked",
          clientId: b.client_id,
        };
      };
      const otherKey = (bucket: { kind: AllocationKind; clientId: string }) =>
        `${bucket.kind}:${bucket.clientId}`;

      // Still open: counted once, against whatever it is booked to.
      const openByProject = new Map<string, number>();
      const openByClient = new Map<string, number>();
      for (const b of briefs) {
        if (b.completed_at) continue;
        const pts = Number(b.original_points ?? 0);
        const bucket = bucketOf(b);
        if (!bucket) continue;
        if (bucket.kind === "project") {
          openByProject.set(bucket.projectId, (openByProject.get(bucket.projectId) ?? 0) + pts);
        } else {
          openByClient.set(otherKey(bucket), (openByClient.get(otherKey(bucket)) ?? 0) + pts);
        }
      }

      return months.map((month) => {
        const isCurrent = month === currentMonth;
        const inMonth = closed.filter((b) => monthKey(b.completed_at!) === month);

        const deliveredByProject = new Map<string, Delivery>();
        const otherByKey = new Map<
          string,
          { d: Delivery; clientId: string; kind: AllocationKind }
        >();

        for (const b of inMonth) {
          const estimate = Number(b.original_points ?? 0) * HOURS_PER_POINT;
          const bucket = bucketOf(b);
          if (!bucket) continue;
          if (bucket.kind === "project") {
            const cur = deliveredByProject.get(bucket.projectId) ?? emptyDelivery();
            deliveredByProject.set(
              bucket.projectId,
              addToDelivery(cur, b.actual_hours, estimate, "brief"),
            );
          } else {
            const k = otherKey(bucket);
            const cur = otherByKey.get(k) ?? {
              d: emptyDelivery(),
              clientId: bucket.clientId,
              kind: bucket.kind,
            };
            otherByKey.set(k, {
              ...cur,
              d: addToDelivery(cur.d, b.actual_hours, estimate, "brief"),
            });
          }
        }

        // The recurring half. It only ever hangs off a project — a provisioned
        // task is provisioned FOR a retainer — so it never reaches the
        // client-level ad hoc / internal / unlinked buckets.
        for (const r of recurringClosed) {
          if (r.month !== month) continue;
          const cur = deliveredByProject.get(r.project_id) ?? emptyDelivery();
          deliveredByProject.set(
            r.project_id,
            addToDelivery(cur, r.actual_hours, Number(r.planned_hours ?? 0), "recurring"),
          );
        }

        const rows: AllocationRow[] = projects
          .filter((p) => p.status !== "completed" || deliveredByProject.has(p.id))
          .map((p) => {
            const d = deliveredByProject.get(p.id) ?? emptyDelivery();
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
              deliveredHours: d.hours,
              measuredHours: d.measuredHours,
              deliveredItems: d.items,
              measuredItems: d.measuredItems,
              recurringHours: d.recurringHours,
              deliveredPoints: d.points,
              briefCount: d.briefs,
              // 0162: the client flag OR the retainer's own. A brand of ours is
              // our own work whatever the retainer says, so this only ever
              // moves a row out of the client book.
              isInternal: internalClientIds.has(p.client_id) || p.is_internal === true,
              openPoints: isCurrent ? openByProject.get(p.id) ?? 0 : 0,
            };
          });

        if (isCurrent) {
          for (const [k, pts] of openByClient) {
            if (!otherByKey.has(k) && pts > 0) {
              const [kind, clientId] = k.split(":") as [AllocationKind, string];
              otherByKey.set(k, { d: emptyDelivery(), clientId, kind });
            }
          }
        }

        for (const [k, v] of otherByKey) {
          const clientId = v.clientId;
          const clientName = clientNameById.get(clientId) ?? "Unknown client";
          const isInternal = v.kind === "internal";
          const kind = v.kind;
          rows.push({
            key: k,
            kind,
            clientName,
            name:
              kind === "adhoc"
                ? "Ad hoc — invoiced separately"
                : kind === "unlinked"
                  ? "Retainer work, no retainer"
                  : "Internal work",
            projectId: null,
            feeCents: 0,
            soldHours: 0,
            committedHours: 0,
            deliveredHours: v.d.hours,
            measuredHours: v.d.measuredHours,
            deliveredItems: v.d.items,
            measuredItems: v.d.measuredItems,
            recurringHours: v.d.recurringHours,
            deliveredPoints: v.d.points,
            briefCount: v.d.briefs,
            isInternal,
            openPoints: isCurrent ? openByClient.get(k) ?? 0 : 0,
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
