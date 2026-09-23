// The capacity dashboard's data: what the team's month could hold, and how much
// of it Conductor can account for (0164-era, Lisa 2026-09-10).
//
// Points, not logged time — see src/lib/capacity.ts for why. Everything briefed
// through Conductor counts: retainer work, ad hoc, internal, and the recurring
// tasks the provisioner creates. A task belongs to the month it CLOSED in,
// which is the same rule the Retainers page uses, so the two never disagree
// about which month a piece of work happened in.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { HOURS_PER_POINT } from "@/hooks/useRetainerAllocation";
import { ongoingHoursInRange, type OngoingTimeEntry } from "@/lib/capacity";
import type { Period } from "@/lib/capacity-period";

/** One task behind a person's hours. Lisa, 2026-09-10: "How can I review the
 *  unassigned work?" — a row saying 30.3h across 25 tasks is a finding you
 *  cannot act on until you can see which tasks. */
export interface CapacityItem {
  id: string;
  name: string;
  clientName: string;
  hours: number;
  /** "tracked" is a task the person logged time against in this period that
   *  did not close in it. It carries tracked hours, not points, and is NOT in
   *  totalHours — it is there so the Tracked column has a list under it. */
  kind: "brief" | "recurring" | "meeting" | "ongoing" | "tracked";
  closedAt: string | null;
}

export interface PersonLoad {
  id: string | null;
  name: string;
  briefedHours: number;
  recurringHours: number;
  /** Internal and client meetings Conductor put in the calendar, by duration. */
  meetingHours: number;
  /** Time logged this month on perpetual tasks that never close (Ops
   *  Development, Finance, the Team page's [Ongoing] rows). No points on
   *  those, so this is the one bucket measured in tracked time (0174). */
  ongoingHours: number;
  totalHours: number;
  /** Raw sprint points on everything closed this month (briefs, recurring,
   *  meetings). The figure ClickUp's points dashboard shows; Lisa reconciles
   *  against it. Ongoing carries no points. */
  totalPoints: number;
  /** Time tracked INSIDE the period, whatever state its task is in (0177).
   *  It used to mean "logged on tasks that closed this period", which
   *  inherited the points bucket's blind spot: work still in flight showed as
   *  nothing, and Sithembile had 19.6 tracked hours on 9 open tasks while her
   *  week read 19.3. A time entry carries a start, so this one can be dated
   *  and a point cannot. Sourced from clickup_time_entries via
   *  tracked_hours_by_user, which is every entry in the workspace — so it
   *  already covers briefs, recurring, meetings and ongoing without four
   *  accumulators that have to agree. */
  trackedHours: number;
  briefCount: number;
  recurringCount: number;
  meetingCount: number;
  ongoingCount: number;
  items: CapacityItem[];
}

export interface CapacityMonth {
  headcount: number;
  accountedHours: number;
  briefedHours: number;
  recurringHours: number;
  meetingHours: number;
  ongoingHours: number;
  trackedHours: number;
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
      // as UTC midnight, which is 02:00 SAST, and at day granularity that
      // puts a task closed at 01:00 on the wrong side of the boundary. See
      // @/lib/capacity-period.
      const { startISO: start, endISO: end } = period;

      const [teamRes, briefsRes, deliveryRes, meetingsRes, clientsRes, ongoingRes, ongoingActualsRes, trackedRes] = await Promise.all([
        supabase.from("team_members").select("id, full_name, clickup_user_id").is("archived_at", null),
        supabase
          .from("briefs")
          .select("id, raw_subject, client_id, completed_at, assignee_id, original_points, clickup_points, clickup_task_id")
          .in("status", ["briefed", "accepted", "quoted", "scoped"])
          .gte("completed_at", start)
          .lt("completed_at", end),
        // closed_at, not the view's `month`: that month is the fee month a
        // recurring task was provisioned for, which is the retainer question.
        // Here the question is when the person spent the time, and Lisa's July
        // GMB weeks closed in August belong to August (0168). It used to read
        // closed_month, which cannot answer a week or a day. Seven closed rows
        // carry no closed_at at all — all of them June and July 2026 — so they
        // drop out of those two months and out of nothing Lisa looks at.
        supabase
          .from("retainer_recurring_delivery")
          .select("clickup_task_id, is_closed, planned_hours, points")
          .eq("is_closed", true)
          .gte("closed_at", start)
          .lt("closed_at", end),
        // Meetings live in their own table and were invisible here; five of
        // Lisa's August tasks were [Meeting] rows. Same rule as a brief: the
        // meeting counts when its ClickUp task is closed, at that task's
        // points (0169), so this page and ClickUp's points dashboard agree.
        supabase
          .from("internal_meeting_tasks")
          .select("id, team_member_id, clickup_points, clickup_closed_at, clickup_task_id, internal_meetings(title, clients(name))")
          .gte("clickup_closed_at", start)
          .lt("clickup_closed_at", end),
        supabase.from("clients").select("id, name"),
        // Perpetual tasks (0174): the Team page's [Ongoing] rows and the
        // adopted open tasks Rize logs against. They never close, so the
        // month is read off the time entries, not off a close date.
        supabase
          .from("ongoing_tasks")
          .select("id, task_name, team_member_id, client_id, clickup_task_id")
          .is("archived_at", null),
        supabase.from("ongoing_actuals_current").select("ongoing_task_id, time_entries"),
        // Summed in Postgres: a month is tens of thousands of intervals and
        // this wants one number per person.
        supabase.rpc("tracked_by_user_task", { p_start: start, p_end: end }),
      ]);
      if (teamRes.error) throw teamRes.error;
      if (briefsRes.error) throw briefsRes.error;
      if (deliveryRes.error) throw deliveryRes.error;
      if (meetingsRes.error) throw meetingsRes.error;
      if (clientsRes.error) throw clientsRes.error;
      if (ongoingRes.error) throw ongoingRes.error;
      if (ongoingActualsRes.error) throw ongoingActualsRes.error;
      if (trackedRes.error) throw trackedRes.error;

      // provisioned_tasks carries the assignee; the delivery view carries
      // whether the task closed and what it was worth. Joined here rather
      // than in SQL because the task ids live in an array column, and fetched
      // by task id rather than period so an earlier period's task closed this
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
          totalHours: 0,
          totalPoints: 0,
          trackedHours: 0,
          briefCount: 0,
          recurringCount: 0,
          meetingCount: 0,
          ongoingCount: 0,
          items: [],
        };
        byPerson.set(key, made);
        return made;
      };
      // Which ClickUp tasks already have a row on a person's list, so the
      // tracked-time pass below only adds what is NOT already there. Keyed the
      // same way the buckets are, Unassigned included.
      const shownTasks = new Map<string, Set<string>>();
      const markTask = (id: string | null, taskId: string | null | undefined) => {
        if (!taskId) return;
        const key = id ?? UNASSIGNED;
        const set = shownTasks.get(key) ?? new Set<string>();
        set.add(taskId);
        shownTasks.set(key, set);
      };

      // Everyone appears, including whoever closed nothing — a capacity view
      // whose whole job is finding people with no work against their name
      // cannot leave them off.
      for (const t of team) bucket(t.id);

      const clientNameById = new Map(
        ((clientsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
      );

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
        const hours = points * HOURS_PER_POINT;
        p.briefedHours += hours;
        p.totalPoints += points;
        p.briefCount += 1;
        markTask(b.assignee_id, b.clickup_task_id);
        p.items.push({
          id: b.id,
          name: b.raw_subject ?? "Untitled brief",
          clientName: b.client_id ? clientNameById.get(b.client_id) ?? "Unknown" : "No client",
          hours,
          kind: "brief",
          closedAt: b.completed_at,
        });
      }

      // Points when the task has them, planned hours only for a snapshot old
      // enough to predate 0169 — the same basis as briefs and as ClickUp.
      const closedHoursByTask = new Map<string, number>();
      const pointsByTask = new Map<string, number>();
      for (const d of (deliveryRes.data ?? []) as Array<{
        clickup_task_id: string;
        is_closed: boolean;
        planned_hours: number | null;
        points: number | null;
      }>) {
        if (!d.is_closed) continue;
        const hours = d.points != null ? Number(d.points) * HOURS_PER_POINT : Number(d.planned_hours ?? 0);
        closedHoursByTask.set(d.clickup_task_id, hours);
        pointsByTask.set(d.clickup_task_id, Number(d.points ?? 0));
      }
      for (const row of (provRes.data ?? []) as unknown as Array<{
        assignee_id: string | null;
        clickup_task_ids: string[] | null;
        projects: { name: string; clients: { name: string } | null } | null;
      }>) {
        for (const taskId of row.clickup_task_ids ?? []) {
          const hours = closedHoursByTask.get(taskId);
          if (hours === undefined) continue;
          const p = bucket(row.assignee_id);
          p.recurringHours += hours;
          p.totalPoints += pointsByTask.get(taskId) ?? 0;
          p.recurringCount += 1;
          markTask(row.assignee_id, taskId);
          p.items.push({
            id: taskId,
            // A recurring task's own ClickUp name is not on this view; the
            // retainer it repeats for is the useful label anyway, because the
            // point of the row is "what is this person's month made of".
            name: row.projects?.name ?? "Recurring task",
            clientName: row.projects?.clients?.name ?? "Unknown",
            hours,
            kind: "recurring",
            closedAt: null,
          });
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
        const hours = Number(t.clickup_points ?? 0) * HOURS_PER_POINT;
        const p = bucket(t.team_member_id);
        p.meetingHours += hours;
        p.totalPoints += Number(t.clickup_points ?? 0);
        p.meetingCount += 1;
        markTask(t.team_member_id, t.clickup_task_id);
        p.items.push({
          id: t.id,
          name: t.internal_meetings?.title ?? "Meeting",
          clientName: t.internal_meetings?.clients?.name ?? "Internal",
          hours,
          kind: "meeting",
          closedAt: t.clickup_closed_at,
        });
      }

      // Time on a perpetual task is credited to whoever logged it, not to the
      // row's owner: Dashboard Development is one ClickUp task four people
      // have logged against. Counted in hours, and it is tracked time, so it
      // lands in both Accounted and Tracked.
      const entriesByTask = new Map(
        ((ongoingActualsRes.data ?? []) as Array<{ ongoing_task_id: string | null; time_entries: unknown }>)
          .map((a) => [a.ongoing_task_id ?? "", (a.time_entries ?? []) as OngoingTimeEntry[]]),
      );
      for (const t of (ongoingRes.data ?? []) as Array<{
        id: string;
        task_name: string;
        team_member_id: string;
        client_id: string | null;
        clickup_task_id: string;
      }>) {
        const byUser = ongoingHoursInRange(entriesByTask.get(t.id) ?? [], start, end);
        for (const [uid, hours] of byUser) {
          if (hours <= 0) continue;
          const p = bucket(memberByClickupUser.get(uid) ?? null);
          p.ongoingHours += hours;
          p.ongoingCount += 1;
          markTask(p.id, t.clickup_task_id);
          p.items.push({
            id: `${t.clickup_task_id}-${uid}`,
            name: t.task_name,
            clientName: t.client_id ? clientNameById.get(t.client_id) ?? "Unknown" : "Internal",
            hours,
            kind: "ongoing",
            closedAt: null,
          });
        }
      }

      // Tracked time is credited to whoever logged it, by ClickUp user id, and
      // an id with no team_members row lands in Unassigned rather than being
      // dropped — the same rule the ongoing bucket follows, and the reason a
      // person who left still shows the hours they worked.
      //
      // A task they logged against that is NOT already on their list gets a row
      // of its own. That list is the whole reason the page is expandable, and
      // without this it answered "what closed" while the Tracked column beside
      // it answered "what you did" — Sithembile's week showed 22.3h tracked
      // over a list of closed tasks adding to 19.3h, with the difference
      // nowhere. These rows carry HOURS, not points, and deliberately do not
      // touch totalHours: that column is the points basis and mixing the two
      // would double-count the moment the task closes.
      const tracked = (trackedRes.data ?? []) as Array<{
        clickup_user_id: number;
        clickup_task_id: string | null;
        task_name: string | null;
        hours: number;
      }>;
      const extraIds = [...new Set(
        tracked
          .filter((r) => {
            const key = memberByClickupUser.get(String(r.clickup_user_id)) ?? UNASSIGNED;
            return r.clickup_task_id && !shownTasks.get(key)?.has(r.clickup_task_id);
          })
          .map((r) => r.clickup_task_id as string),
      )];
      // Conductor's own title and client for those tasks where it has them. A
      // ClickUp name with no client reads like a row from another system.
      const briefByTask = new Map<string, { name: string; clientName: string }>();
      if (extraIds.length) {
        const { data } = await supabase
          .from("briefs")
          .select("raw_subject, client_id, clickup_task_id")
          .in("clickup_task_id", extraIds);
        for (const b of (data ?? []) as Array<{ raw_subject: string | null; client_id: string | null; clickup_task_id: string | null }>) {
          if (!b.clickup_task_id) continue;
          briefByTask.set(b.clickup_task_id, {
            name: b.raw_subject ?? "Untitled brief",
            clientName: b.client_id ? clientNameById.get(b.client_id) ?? "Unknown" : "No client",
          });
        }
      }
      for (const r of tracked) {
        const memberId = memberByClickupUser.get(String(r.clickup_user_id)) ?? null;
        const p = bucket(memberId);
        p.trackedHours += Number(r.hours ?? 0);
        if (!r.clickup_task_id || shownTasks.get(memberId ?? UNASSIGNED)?.has(r.clickup_task_id)) continue;
        const known = briefByTask.get(r.clickup_task_id);
        p.items.push({
          id: r.clickup_task_id,
          name: known?.name ?? r.task_name ?? "Untitled task",
          clientName: known?.clientName ?? "—",
          hours: Number(r.hours ?? 0),
          kind: "tracked",
          closedAt: null,
        });
      }

      const people = [...byPerson.values()].map((p) => ({
        ...p,
        totalHours: p.briefedHours + p.recurringHours + p.meetingHours + p.ongoingHours,
        // Biggest first: reviewing a person's month starts with what took the
        // most of it.
        items: [...p.items].sort((a, b) => b.hours - a.hours),
      }));
      people.sort((a, b) => b.totalHours - a.totalHours);

      const briefedHours = people.reduce((n, p) => n + p.briefedHours, 0);
      const recurringHours = people.reduce((n, p) => n + p.recurringHours, 0);
      const meetingHours = people.reduce((n, p) => n + p.meetingHours, 0);
      const ongoingHours = people.reduce((n, p) => n + p.ongoingHours, 0);
      const trackedHours = people.reduce((n, p) => n + p.trackedHours, 0);
      return {
        headcount: team.length,
        accountedHours: briefedHours + recurringHours + meetingHours + ongoingHours,
        briefedHours,
        recurringHours,
        meetingHours,
        ongoingHours,
        trackedHours,
        people,
      };
    },
  });
}
