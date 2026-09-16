// Three numbers per retainer, per month — because one number could never do
// the job. The page calls them Planned, Scheduled and Completed; the fields
// keep their original names:
//
//   soldHours      PLANNED — what the monthly fee buys at the standard rate.
//                  A pricing fact.
//   committedHours SCHEDULED — the recurring tasks that were actually created
//                  for this month. Work briefed ad hoc is not in here.
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
import { openForMonth } from "@/lib/retainer-drilldown";

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

/** One brief behind a row's numbers — what the Ad Hoc and Internal tabs expand
 *  to show. A category total answers "how much"; only this answers "what". */
export interface DeliveryItem {
  id: string;
  name: string;
  /** Valued the same way the total is: logged time if anyone logged it. */
  hours: number;
  measured: boolean;
  /** null = raised this month and still running. */
  completedAt: string | null;
  /** What it was due by. Shown beside an open item so one that is weeks late
   *  reads as late rather than as this month's work. Null on plenty of rows —
   *  22 briefs carry no due date at all. */
  dueDate: string | null;
}

export interface AllocationRow {
  key: string;
  kind: AllocationKind;
  clientName: string;
  /** Needed to join anything keyed on the client — the invoiced amounts on the
   *  Ad Hoc tab (0164) are per client per month, and matching on name would
   *  break the day two clients share one. */
  clientId: string | null;
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
  /** The briefs themselves, closed ones first then whatever is still open.
   *  Empty on a row whose work is recurring tasks rather than briefs — those
   *  already drill down through RetainerSubItems. */
  items: DeliveryItem[];
  /** Our own work rather than a paying client's — the client being one of our
   *  brands (clients.is_internal, 0152) or this one retainer being flagged
   *  (projects.is_internal, 0162). */
  isInternal: boolean;
  /** Points raised against this row and not yet closed. A "now" figure, so it
   *  is only meaningful on the current month. */
  openPoints: number;
  /** Hours of recurring tasks provisioned for the month and not yet closed,
   *  at their estimate. With openPoints this is what is still due. */
  scheduledOpenHours: number;
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
  id: string;
  raw_subject: string | null;
  parent_project_id: string | null;
  client_id: string | null;
  billing_type: string | null;
  original_points: number | null;
  actual_hours: number | null;
  created_at: string;
  completed_at: string | null;
  original_due_date: string | null;
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
  /** The briefs themselves; `items` below is their count. */
  list: DeliveryItem[];
  hours: number;
  measuredHours: number;
  items: number;
  measuredItems: number;
  recurringHours: number;
  points: number;
  briefs: number;
}

const emptyDelivery = (): Delivery => ({
  list: [],
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
  /** Omitted for a recurring task: the view carries no name for one, and those
   *  rows already drill down through RetainerSubItems. */
  item?: Omit<DeliveryItem, "hours" | "measured">,
): Delivery {
  const { hours, measured } = hoursOf(actual, estimate);
  return {
    list: item ? [...d.list, { ...item, hours, measured }] : d.list,
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

      const [projectsRes, briefsRes, clientsRes, recurringRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, client_id, status, engagement_type, retainer_hours_target, retainer_monthly_fee_cents, is_internal, clients(name)")
          .in("engagement_type", ["retainer", "fixed"])
          .neq("status", "archived"),
        supabase
          .from("briefs")
          .select("id, raw_subject, parent_project_id, client_id, billing_type, original_points, actual_hours, created_at, completed_at, original_due_date")
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

      const recurring = (recurringRes.data ?? []) as unknown as RecurringRow[];

      // SCHEDULED is what the provisioner actually created for the month, not
      // what retainer_recurring_services says it should have (Lisa, 2026-09-08).
      // The config is an instruction; the provisioner INTERPRETS it —
      // roll_up_monthly collapses occurrences into one task, a service with
      // occurrence labels is shared between its assignees instead of copied per
      // assignee, recur_weekday fans out per weekday in the period — and lands
      // somewhere else. Trellidor SEO's config summed to 9h and three tasks
      // worth 3h were made; four monthly feedback meetings summed to 1.25h and
      // 2.25h was made. Neither number was a lie, but only one of them is the
      // work that exists, and the gap against Planned is the thing worth
      // seeing: Kings College Marketing has 0h scheduled against R22,200, and
      // Dovetail SEO has 12.75h against the 7.08h its fee buys.
      //
      // It also retires the second copy of this sum: retainerMath's
      // retainerRowStats multiplies by assignee count and this did not, so the
      // New Retainer wizard and this page disagreed on the same retainer. There
      // is now one answer and the provisioner owns it.
      //
      // Consequence to know: provisioned_tasks only go back to June 2026, so an
      // earlier month reads 0 scheduled. That is "we have no record", not "we
      // scheduled nothing" — but printing the CURRENT config against a month it
      // was never in force for would be the worse lie.
      const scheduledByProjectMonth = new Map<string, number>();
      for (const r of recurring) {
        const k = `${r.project_id}|${r.month}`;
        scheduledByProjectMonth.set(
          k,
          (scheduledByProjectMonth.get(k) ?? 0) + Number(r.planned_hours ?? 0),
        );
      }

      // STILL DUE, the recurring half: what the provisioner made for the month
      // that has not closed yet, at its estimate. Lisa, 2026-09-16: Completed
      // carried the open work as a "+5.5h" tag in the same cell and she wanted
      // "actual completed vs still due" as two numbers.
      const scheduledOpenByProjectMonth = new Map<string, number>();
      for (const r of recurring) {
        if (r.is_closed) continue;
        const k = `${r.project_id}|${r.month}`;
        scheduledOpenByProjectMonth.set(
          k,
          (scheduledOpenByProjectMonth.get(k) ?? 0) + Number(r.planned_hours ?? 0),
        );
      }

      const clientRows = (clientsRes.data ?? []) as Array<{ id: string; name: string; is_internal: boolean }>;
      const clientNameById = new Map(clientRows.map((c) => [c.id, c.name]));
      const internalClientIds = new Set(clientRows.filter((c) => c.is_internal).map((c) => c.id));

      // Only closed recurring tasks are delivery. An open one is scheduled
      // work that has not happened — the Scheduled column's business, not this
      // one's.
      const recurringClosed = recurring.filter((r) => r.is_closed);

      // Months are the months work CLOSED in, newest first. A retainer serviced
      // entirely by standing tasks closes no briefs at all, so its months have
      // to come from the recurring side too or they never appear.
      const closed = briefs.filter((b) => b.completed_at != null);
      const months = [
        ...new Set([
          ...closed.map((b) => monthKey(b.completed_at!)),
          ...recurring.map((r) => r.month),
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
        // Internal first, from either direction (0165): the client is one of our
        // brands, OR this piece of work was marked internal on a paying client.
        // The second is the case that had nowhere to go — adhoc claimed we
        // invoiced it, retainer claimed a fee covered it, and both overstated
        // what the client was billed. Like every other internal flag here it can
        // only move work OUT of the billable book, never into it.
        if (b.client_id && (internalClientIds.has(b.client_id) || b.billing_type === "internal")) {
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

      // Still open: counted once, against whatever it is booked to. The items
      // ride along so an expanded row can name what is still running, not just
      // total it — an open brief is the half of "what came in" that a
      // completed-only list would hide.
      const openItemsByProject = new Map<string, DeliveryItem[]>();
      const openItemsByClient = new Map<string, DeliveryItem[]>();
      for (const b of briefs) {
        if (b.completed_at) continue;
        const pts = Number(b.original_points ?? 0);
        const bucket = bucketOf(b);
        if (!bucket) continue;
        const item: DeliveryItem = {
          id: b.id,
          name: b.raw_subject ?? "Untitled brief",
          hours: pts * HOURS_PER_POINT,
          measured: false,
          completedAt: null,
          dueDate: b.original_due_date ?? null,
        };
        if (bucket.kind === "project") {
          openItemsByProject.set(bucket.projectId, [
            ...(openItemsByProject.get(bucket.projectId) ?? []),
            item,
          ]);
        } else {
          const k = otherKey(bucket);
          openItemsByClient.set(k, [...(openItemsByClient.get(k) ?? []), item]);
        }
      }

      return months.map((month) => {
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
          const item = {
            id: b.id,
            name: b.raw_subject ?? "Untitled brief",
            completedAt: b.completed_at,
            dueDate: b.original_due_date ?? null,
          };
          if (bucket.kind === "project") {
            const cur = deliveredByProject.get(bucket.projectId) ?? emptyDelivery();
            deliveredByProject.set(
              bucket.projectId,
              addToDelivery(cur, b.actual_hours, estimate, "brief", item),
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
              d: addToDelivery(cur.d, b.actual_hours, estimate, "brief", item),
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
              clientId: p.client_id,
              name: p.name,
              projectId: p.id,
              feeCents: p.retainer_monthly_fee_cents ?? 0,
              soldHours: Number(p.retainer_hours_target ?? 0),
              committedHours: scheduledByProjectMonth.get(`${p.id}|${month}`) ?? 0,
              deliveredHours: d.hours,
              measuredHours: d.measuredHours,
              deliveredItems: d.items,
              measuredItems: d.measuredItems,
              recurringHours: d.recurringHours,
              deliveredPoints: d.points,
              briefCount: d.briefs,
              items: [...d.list, ...openForMonth(month, openItemsByProject.get(p.id) ?? []).items],
              // 0162: the client flag OR the retainer's own. A brand of ours is
              // our own work whatever the retainer says, so this only ever
              // moves a row out of the client book.
              isInternal: internalClientIds.has(p.client_id) || p.is_internal === true,
              // Derived from the same filtered list the row expands to show,
              // so the number and the rows behind it cannot disagree.
              openPoints:
                openForMonth(month, openItemsByProject.get(p.id) ?? []).hours / HOURS_PER_POINT,
              scheduledOpenHours: scheduledOpenByProjectMonth.get(`${p.id}|${month}`) ?? 0,
            };
          });

        // A client whose only work this month is still open still needs a row,
        // or the thing you are looking for is the thing that is missing.
        for (const [k, items] of openItemsByClient) {
          if (!otherByKey.has(k) && openForMonth(month, items).items.length > 0) {
            const [kind, clientId] = k.split(":") as [AllocationKind, string];
            otherByKey.set(k, { d: emptyDelivery(), clientId, kind });
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
            clientId,
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
            items: [...v.d.list, ...openForMonth(month, openItemsByClient.get(k) ?? []).items],
            isInternal,
            openPoints:
              openForMonth(month, openItemsByClient.get(k) ?? []).hours / HOURS_PER_POINT,
            // Recurring tasks only ever hang off a retainer.
            scheduledOpenHours: 0,
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
