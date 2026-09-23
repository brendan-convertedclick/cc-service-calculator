// The capacity dashboard's data: what the team's period could hold, and how
// much of it they actually spent (0177/0178, Lisa and Brendan 2026-09-23).
//
// MEASURED IN TRACKED HOURS. It used to be points, and the reason it changed
// is Brendan's week of 14 September: 57 hours worked, six days, 06:00 starts,
// and the page said 79% of a 35 hour week. Points only exist on briefed,
// recurring and meeting tasks, so a week spent on perpetual work carried
// almost none — 17 points against 56.8 tracked hours. Worse, Total hours was
// already a hybrid: three of its four parts were points converted to hours and
// the fourth (Ongoing) was real logged time, so nothing on the row reconciled
// with anything else on it.
//
// Now every hour column on this page is the same thing: time logged in ClickUp
// (via Rize) inside the period, whatever state its task is in, read from
// clickup_time_entries. They add up, and the percentage means what it says.
//
// POINTS SURVIVE AS THEIR OWN COLUMN, and that is deliberate (Lisa,
// 2026-09-23: "I want to still have a view of completed points"). They answer
// a different question — what was allocated and closed — and they are the only
// figure ClickUp's own points dashboard can be reconciled against.
//
// The two are credited to different people ON PURPOSE. Points go to the task's
// ASSIGNEE, because that is whose work it was. Hours go to whoever LOGGED
// them, because that is who spent the time. A brief assigned to one person and
// worked by another shows on both rows, once in each currency, which is the
// truth rather than a bug.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Period } from "@/lib/capacity-period";

/** What a task is, which decides the column its hours land in. */
export type ItemKind = "brief" | "recurring" | "meeting" | "ongoing" | "other";

/** One task behind a person's numbers. Lisa, 2026-09-10: "How can I review the
 *  unassigned work?" — a row saying 30.3h across 25 tasks is a finding you
 *  cannot act on until you can see which tasks.
 *
 *  It carries BOTH currencies, because the row above it does: `hours` is time
 *  this person logged on it inside the period, `points` is what it was worth
 *  if it closed here. Either can be zero on a perfectly normal row — a task
 *  closed on Monday but worked entirely last week has points and no hours; one
 *  still in flight has hours and no points. */
export interface CapacityItem {
  id: string;
  name: string;
  clientName: string;
  hours: number;
  points: number;
  kind: ItemKind;
  closedAt: string | null;
}

export interface PersonLoad {
  id: string | null;
  name: string;
  /** All five are tracked hours, split by what the task is. They sum to
   *  totalHours exactly — no conversions, no second basis. */
  briefedHours: number;
  recurringHours: number;
  meetingHours: number;
  ongoingHours: number;
  /** Time on a task that is none of the above: an ad hoc ClickUp card, a daily
   *  stand-up, a meeting whose task did not close here. It is a real column
   *  rather than a rounding gap because it is where the honest surprises live
   *  — four stand-ups a week were counted nowhere until it existed, for
   *  anybody. */
  otherHours: number;
  /** Every hour logged in the period. The basis for "of capacity". */
  totalHours: number;
  /** Sprint points on everything that CLOSED in the period and was assigned to
   *  them: briefs, recurring, meetings. The figure ClickUp's points dashboard
   *  shows, kept as its own column and never mixed into the hours. */
  totalPoints: number;
  briefCount: number;
  recurringCount: number;
  meetingCount: number;
  ongoingCount: number;
  otherCount: number;
  items: CapacityItem[];
}

export interface CapacityMonth {
  headcount: number;
  /** Total tracked hours — what "accounted for" now means. */
  accountedHours: number;
  briefedHours: number;
  recurringHours: number;
  meetingHours: number;
  ongoingHours: number;
  otherHours: number;
  totalPoints: number;
  people: PersonLoad[];
}

/** The row for work nobody is assigned to. Kept as a person-shaped row rather
 *  than dropped: 30 of August's 201 hours had no assignee, and hiding them
 *  would make the team look busier than it is AND lose the fact that 25 tasks
 *  went out with nobody's name on them. */
export const UNASSIGNED = "Unassigned";

export function useTeamCapacity(period: Period) {
  return useQuery({
    queryKey: ["team_capacity", period.kind, period.anchor],
    queryFn: async (): Promise<CapacityMonth> => {
      // Local-midnight instants, not bare dates: a bare "2026-09-01" is read
      // as UTC midnight, which is 02:00 SAST, and at day granularity that puts
      // a task closed at 01:00 on the wrong side of the boundary. See
      // @/lib/capacity-period.
      const { startISO: start, endISO: end } = period;

      const [teamRes, briefsRes, deliveryRes, meetingsRes, clientsRes, ongoingRes, trackedRes] = await Promise.all([
        supabase.from("team_members").select("id, full_name, clickup_user_id").is("archived_at", null),
        supabase
          .from("briefs")
          .select("id, raw_subject, client_id, completed_at, assignee_id, original_points, clickup_points, clickup_task_id")
          .in("status", ["briefed", "accepted", "quoted", "scoped"])
          .gte("completed_at", start)
          .lt("completed_at", end),
        // closed_at, not the view's `month`: that month is the fee month a
        // recurring task was provisioned for, which is the retainer question.
        // Here the question is when the work happened, and Lisa's July GMB
        // weeks closed in August belong to August (0168).
        supabase
          .from("retainer_recurring_delivery")
          .select("clickup_task_id, is_closed, points")
          .eq("is_closed", true)
          .gte("closed_at", start)
          .lt("closed_at", end),
        // Meetings live in their own table and were invisible here; five of
        // Lisa's August tasks were [Meeting] rows. A meeting's POINTS land
        // when its ClickUp task closes (0169), which is why this query is
        // still filtered on the close date; its hours arrive with everyone
        // else's, off the time entries.
        supabase
          .from("internal_meeting_tasks")
          .select("id, team_member_id, clickup_points, clickup_closed_at, clickup_task_id, internal_meetings(title, clients(name))")
          .gte("clickup_closed_at", start)
          .lt("clickup_closed_at", end),
        supabase.from("clients").select("id, name"),
        // Perpetual tasks (0174). They never close, so they carry no points at
        // all — their entire contribution is hours, which is why this was the
        // one bucket already measured this way before the switch.
        supabase
          .from("ongoing_tasks")
          .select("id, task_name, client_id, clickup_task_id")
          .is("archived_at", null),
        // Summed in Postgres: a month is tens of thousands of intervals and
        // this wants one row per person per task.
        supabase.rpc("tracked_by_user_task", { p_start: start, p_end: end }),
      ]);
      if (teamRes.error) throw teamRes.error;
      if (briefsRes.error) throw briefsRes.error;
      if (deliveryRes.error) throw deliveryRes.error;
      if (meetingsRes.error) throw meetingsRes.error;
      if (clientsRes.error) throw clientsRes.error;
      if (ongoingRes.error) throw ongoingRes.error;
      if (trackedRes.error) throw trackedRes.error;

      // provisioned_tasks carries the assignee; the delivery view carries
      // whether the task closed and what it was worth. Joined here rather than
      // in SQL because the task ids live in an array column, and fetched by
      // task id rather than period so an earlier period's task closed this
      // month still finds its owner.
      const closedIds = (deliveryRes.data ?? []).map((d) => d.clickup_task_id).filter((id): id is string => !!id);
      const provRes = closedIds.length
        ? await supabase
          .from("provisioned_tasks")
          .select("assignee_id, clickup_task_ids, projects(name, clients(name))")
          .overlaps("clickup_task_ids", closedIds)
        : { data: [], error: null };
      if (provRes.error) throw provRes.error;

      const team = (teamRes.data ?? []) as Array<{ id: string; full_name: string; clickup_user_id: number | null }>;
      const nameById = new Map(team.map((t) => [t.id, t.full_name]));
      const memberByClickupUser = new Map(
        team.filter((t) => t.clickup_user_id != null).map((t) => [String(t.clickup_user_id), t.id]),
      );
      const clientNameById = new Map(
        ((clientsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
      );

      const byPerson = new Map<string, PersonLoad>();
      const bucket = (id: string | null): PersonLoad => {
        const key = id ?? UNASSIGNED;
        const cur = byPerson.get(key);
        if (cur) return cur;
        const made: PersonLoad = {
          id,
          name: id ? nameById.get(id) ?? "Unknown" : UNASSIGNED,
          briefedHours: 0,
          recurringHours: 0,
          meetingHours: 0,
          ongoingHours: 0,
          otherHours: 0,
          totalHours: 0,
          totalPoints: 0,
          briefCount: 0,
          recurringCount: 0,
          meetingCount: 0,
          ongoingCount: 0,
          otherCount: 0,
          items: [],
        };
        byPerson.set(key, made);
        return made;
      };
      // Everyone appears, including whoever closed nothing — a capacity view
      // whose whole job is finding people with no work against their name
      // cannot leave them off.
      for (const t of team) bucket(t.id);

      // One item per (person, task). Points arrive from the assignee's side,
      // hours from the logger's, and they meet here — the only place the two
      // currencies are allowed to touch.
      const itemsByPerson = new Map<string, Map<string, CapacityItem>>();
      const item = (
        personId: string | null,
        key: string,
        seed: Omit<CapacityItem, "hours" | "points">,
      ): CapacityItem => {
        const pk = personId ?? UNASSIGNED;
        const forPerson = itemsByPerson.get(pk) ?? new Map<string, CapacityItem>();
        itemsByPerson.set(pk, forPerson);
        const cur = forPerson.get(key);
        if (cur) return cur;
        const made: CapacityItem = { ...seed, hours: 0, points: 0 };
        forPerson.set(key, made);
        return made;
      };

      // What kind each ClickUp task is, so a tracked hour lands in the right
      // column even when the person who logged it is not the assignee.
      const kindByTask = new Map<string, ItemKind>();
      for (const o of (ongoingRes.data ?? []) as Array<{ clickup_task_id: string | null }>) {
        if (o.clickup_task_id) kindByTask.set(o.clickup_task_id, "ongoing");
      }

      for (const b of (briefsRes.data ?? []) as Array<{
        id: string;
        raw_subject: string | null;
        client_id: string | null;
        completed_at: string | null;
        assignee_id: string | null;
        original_points: number | null;
        clickup_points: number | null;
        clickup_task_id: string | null;
      }>) {
        const p = bucket(b.assignee_id);
        // Live points first (0170): original_points is the frozen estimate,
        // and ClickUp's dashboard sums what the task says today.
        const points = Number(b.clickup_points ?? b.original_points ?? 0);
        p.totalPoints += points;
        p.briefCount += 1;
        if (b.clickup_task_id) kindByTask.set(b.clickup_task_id, "brief");
        item(b.assignee_id, b.clickup_task_id ?? b.id, {
          id: b.clickup_task_id ?? b.id,
          name: b.raw_subject ?? "Untitled brief",
          clientName: b.client_id ? clientNameById.get(b.client_id) ?? "Unknown" : "No client",
          kind: "brief",
          closedAt: b.completed_at,
        }).points += points;
      }

      const pointsByTask = new Map<string, number>();
      for (const d of (deliveryRes.data ?? []) as Array<{
        clickup_task_id: string;
        is_closed: boolean;
        points: number | null;
      }>) {
        if (!d.is_closed) continue;
        pointsByTask.set(d.clickup_task_id, Number(d.points ?? 0));
        kindByTask.set(d.clickup_task_id, "recurring");
      }
      for (const row of (provRes.data ?? []) as unknown as Array<{
        assignee_id: string | null;
        clickup_task_ids: string[] | null;
        projects: { name: string; clients: { name: string } | null } | null;
      }>) {
        for (const taskId of row.clickup_task_ids ?? []) {
          const points = pointsByTask.get(taskId);
          if (points === undefined) continue;
          const p = bucket(row.assignee_id);
          p.totalPoints += points;
          p.recurringCount += 1;
          item(row.assignee_id, taskId, {
            id: taskId,
            // A recurring task's own ClickUp name is not on this view; the
            // retainer it repeats for is the useful label anyway.
            name: row.projects?.name ?? "Recurring task",
            clientName: row.projects?.clients?.name ?? "Unknown",
            kind: "recurring",
            closedAt: null,
          }).points += points;
        }
      }

      for (const t of (meetingsRes.data ?? []) as unknown as Array<{
        id: string;
        team_member_id: string | null;
        clickup_points: number | null;
        clickup_closed_at: string | null;
        clickup_task_id: string | null;
        internal_meetings: { title: string; clients: { name: string } | null } | null;
      }>) {
        if (!t.team_member_id) continue;
        const points = Number(t.clickup_points ?? 0);
        const p = bucket(t.team_member_id);
        p.totalPoints += points;
        p.meetingCount += 1;
        if (t.clickup_task_id) kindByTask.set(t.clickup_task_id, "meeting");
        item(t.team_member_id, t.clickup_task_id ?? t.id, {
          id: t.clickup_task_id ?? t.id,
          name: t.internal_meetings?.title ?? "Meeting",
          clientName: t.internal_meetings?.clients?.name ?? "Internal",
          kind: "meeting",
          closedAt: t.clickup_closed_at,
        }).points += points;
      }

      const trackedRows = (trackedRes.data ?? []) as Array<{
        clickup_user_id: number;
        clickup_task_id: string | null;
        task_name: string | null;
        hours: number;
      }>;
      // Conductor's own title and client for tasks that are only reaching this
      // page through their tracked time. A bare ClickUp name with no client
      // beside it reads like a row from another system.
      const unknownIds = [...new Set(
        trackedRows
          .map((r) => r.clickup_task_id)
          .filter((id): id is string => !!id && !kindByTask.has(id)),
      )];
      const briefByTask = new Map<string, { name: string; clientName: string }>();
      if (unknownIds.length) {
        const { data } = await supabase
          .from("briefs")
          .select("raw_subject, client_id, clickup_task_id")
          .in("clickup_task_id", unknownIds);
        for (const b of (data ?? []) as Array<{
          raw_subject: string | null;
          client_id: string | null;
          clickup_task_id: string | null;
        }>) {
          if (!b.clickup_task_id) continue;
          kindByTask.set(b.clickup_task_id, "brief");
          briefByTask.set(b.clickup_task_id, {
            name: b.raw_subject ?? "Untitled brief",
            clientName: b.client_id ? clientNameById.get(b.client_id) ?? "Unknown" : "No client",
          });
        }
      }
      const ongoingByTask = new Map(
        ((ongoingRes.data ?? []) as Array<{ task_name: string; client_id: string | null; clickup_task_id: string }>)
          .map((o) => [o.clickup_task_id, o]),
      );

      // Hours are credited to whoever LOGGED them, by ClickUp user id, and an
      // id with no team_members row lands in Unassigned rather than being
      // dropped — the reason a person who has left still shows the hours they
      // worked.
      for (const r of trackedRows) {
        const memberId = memberByClickupUser.get(String(r.clickup_user_id)) ?? null;
        const p = bucket(memberId);
        const hours = Number(r.hours ?? 0);
        const taskId = r.clickup_task_id;
        const kind: ItemKind = (taskId ? kindByTask.get(taskId) : undefined) ?? "other";
        if (kind === "brief") p.briefedHours += hours;
        else if (kind === "recurring") p.recurringHours += hours;
        else if (kind === "meeting") p.meetingHours += hours;
        else if (kind === "ongoing") p.ongoingHours += hours;
        else p.otherHours += hours;

        const ongoing = taskId ? ongoingByTask.get(taskId) : undefined;
        const known = taskId ? briefByTask.get(taskId) : undefined;
        const ongoingClient = ongoing?.client_id ? clientNameById.get(ongoing.client_id) ?? "Unknown" : undefined;
        item(memberId, taskId ?? `untasked-${r.clickup_user_id}`, {
          id: taskId ?? `untasked-${r.clickup_user_id}`,
          name: known?.name ?? ongoing?.task_name ?? r.task_name ?? "Untitled task",
          clientName: known?.clientName ?? ongoingClient ?? (kind === "ongoing" ? "Internal" : "—"),
          kind,
          closedAt: null,
        }).hours += hours;
      }

      const people = [...byPerson.values()].map((p) => {
        const items = [...(itemsByPerson.get(p.id ?? UNASSIGNED)?.values() ?? [])];
        return {
          ...p,
          totalHours: p.briefedHours + p.recurringHours + p.meetingHours + p.ongoingHours + p.otherHours,
          ongoingCount: items.filter((i) => i.kind === "ongoing").length,
          otherCount: items.filter((i) => i.kind === "other").length,
          // Biggest first: reviewing a person's period starts with what took
          // the most of it, and hours are what the row is measured in now.
          items: items.sort((a, b) => b.hours - a.hours || b.points - a.points),
        };
      });
      people.sort((a, b) => b.totalHours - a.totalHours);

      const sum = (f: (p: PersonLoad) => number) => people.reduce((n, p) => n + f(p), 0);
      const briefedHours = sum((p) => p.briefedHours);
      const recurringHours = sum((p) => p.recurringHours);
      const meetingHours = sum((p) => p.meetingHours);
      const ongoingHours = sum((p) => p.ongoingHours);
      const otherHours = sum((p) => p.otherHours);
      return {
        headcount: team.length,
        accountedHours: briefedHours + recurringHours + meetingHours + ongoingHours + otherHours,
        briefedHours,
        recurringHours,
        meetingHours,
        ongoingHours,
        otherHours,
        totalPoints: sum((p) => p.totalPoints),
        people,
      };
    },
  });
}
