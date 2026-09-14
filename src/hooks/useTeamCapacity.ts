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

/** One task behind a person's hours. Lisa, 2026-09-10: "How can I review the
 *  unassigned work?" — a row saying 30.3h across 25 tasks is a finding you
 *  cannot act on until you can see which tasks. */
export interface CapacityItem {
  id: string;
  name: string;
  clientName: string;
  hours: number;
  kind: "brief" | "recurring" | "meeting";
  closedAt: string | null;
}

export interface PersonLoad {
  id: string | null;
  name: string;
  briefedHours: number;
  recurringHours: number;
  /** Internal and client meetings Conductor put in the calendar, by duration. */
  meetingHours: number;
  totalHours: number;
  briefCount: number;
  recurringCount: number;
  meetingCount: number;
  items: CapacityItem[];
}

export interface CapacityMonth {
  headcount: number;
  accountedHours: number;
  briefedHours: number;
  recurringHours: number;
  meetingHours: number;
  people: PersonLoad[];
}

/** The row for work nobody is assigned to. Kept as a person-shaped row rather
 *  than dropped: 30 of August's 201 hours had no assignee, and hiding them
 *  would make the team look busier than it is AND lose the fact that 25 tasks
 *  went out with nobody's name on them. */
export const UNASSIGNED = "Unassigned";

export function useTeamCapacity(month: string) {
  return useQuery({
    queryKey: ["team_capacity", month],
    queryFn: async (): Promise<CapacityMonth> => {
      const [y, m] = month.split("-").map(Number);
      const start = `${month}-01`;
      const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

      const [teamRes, briefsRes, deliveryRes, meetingsRes, clientsRes] = await Promise.all([
        supabase.from("team_members").select("id, full_name").is("archived_at", null),
        supabase
          .from("briefs")
          .select("id, raw_subject, client_id, completed_at, assignee_id, original_points")
          .in("status", ["briefed", "accepted", "quoted", "scoped"])
          .gte("completed_at", start)
          .lt("completed_at", end),
        // closed_month, not month: the delivery view's `month` is the fee
        // month a recurring task was provisioned for, which is the retainer
        // question. Here the question is when the person spent the time, and
        // Lisa's July GMB weeks closed in August belong to August (0168).
        supabase
          .from("retainer_recurring_delivery")
          .select("clickup_task_id, is_closed, planned_hours")
          .eq("closed_month", month)
          .eq("is_closed", true),
        // Meetings live in their own table and were invisible here; five of
        // Lisa's August tasks were [Meeting] rows. Duration is the honest
        // figure — a 30-minute stand-up is 30 minutes whatever its points say.
        supabase
          .from("internal_meetings")
          .select("id, title, starts_at, ends_at, clients(name), internal_meeting_tasks(team_member_id)")
          .gte("starts_at", start)
          .lt("starts_at", end)
          .neq("status", "cancelled"),
        supabase.from("clients").select("id, name"),
      ]);
      if (teamRes.error) throw teamRes.error;
      if (briefsRes.error) throw briefsRes.error;
      if (deliveryRes.error) throw deliveryRes.error;
      if (meetingsRes.error) throw meetingsRes.error;
      if (clientsRes.error) throw clientsRes.error;

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

      const team = (teamRes.data ?? []) as Array<{ id: string; full_name: string }>;
      const nameById = new Map(team.map((t) => [t.id, t.full_name]));

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
          totalHours: 0,
          briefCount: 0,
          recurringCount: 0,
          meetingCount: 0,
          items: [],
        };
        byPerson.set(key, made);
        return made;
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
      }>) {
        const p = bucket(b.assignee_id);
        const hours = Number(b.original_points ?? 0) * HOURS_PER_POINT;
        p.briefedHours += hours;
        p.briefCount += 1;
        p.items.push({
          id: b.id,
          name: b.raw_subject ?? "Untitled brief",
          clientName: b.client_id ? clientNameById.get(b.client_id) ?? "Unknown" : "No client",
          hours,
          kind: "brief",
          closedAt: b.completed_at,
        });
      }

      const closedHoursByTask = new Map<string, number>();
      for (const d of (deliveryRes.data ?? []) as Array<{
        clickup_task_id: string;
        is_closed: boolean;
        planned_hours: number | null;
      }>) {
        if (d.is_closed) closedHoursByTask.set(d.clickup_task_id, Number(d.planned_hours ?? 0));
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
          p.recurringCount += 1;
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

      for (const m of (meetingsRes.data ?? []) as unknown as Array<{
        id: string;
        title: string;
        starts_at: string;
        ends_at: string;
        clients: { name: string } | null;
        internal_meeting_tasks: Array<{ team_member_id: string | null }>;
      }>) {
        const hours = Math.round(((Date.parse(m.ends_at) - Date.parse(m.starts_at)) / 3_600_000) * 100) / 100;
        if (!(hours > 0)) continue;
        for (const t of m.internal_meeting_tasks) {
          if (!t.team_member_id) continue;
          const p = bucket(t.team_member_id);
          p.meetingHours += hours;
          p.meetingCount += 1;
          p.items.push({
            id: `${m.id}:${t.team_member_id}`,
            name: m.title,
            clientName: m.clients?.name ?? "Internal",
            hours,
            kind: "meeting",
            closedAt: m.starts_at,
          });
        }
      }

      const people = [...byPerson.values()].map((p) => ({
        ...p,
        totalHours: p.briefedHours + p.recurringHours + p.meetingHours,
        // Biggest first: reviewing a person's month starts with what took the
        // most of it.
        items: [...p.items].sort((a, b) => b.hours - a.hours),
      }));
      people.sort((a, b) => b.totalHours - a.totalHours);

      const briefedHours = people.reduce((n, p) => n + p.briefedHours, 0);
      const recurringHours = people.reduce((n, p) => n + p.recurringHours, 0);
      const meetingHours = people.reduce((n, p) => n + p.meetingHours, 0);
      return {
        headcount: team.length,
        accountedHours: briefedHours + recurringHours + meetingHours,
        briefedHours,
        recurringHours,
        meetingHours,
        people,
      };
    },
  });
}
