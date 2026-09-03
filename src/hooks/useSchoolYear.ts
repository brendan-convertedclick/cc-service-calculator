// src/hooks/useSchoolYear.ts
//
// One school's year: its months, its tasks, and every mutation the planner
// (/pipeline/:yearId) and the drawer perform on them. All the DATE and
// STATE maths — due dates, planned→scheduled, client_approvals rows — lives
// in schedule_school_year_month / close_school_year_month / the
// tg_school_tasks_guard trigger (0150_school_pipeline.sql), never here: this
// file writes only the columns a human actually clicked (month_no, done,
// account owner, ...) and lets the DB derive the rest. See that migration's
// "Delta B" for why state-follows-the-column is a trigger and not a branch
// in useMoveTask.

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/utils";
import type { Json } from "@/types/db";
import { PIPELINE_BOARD_KEY } from "@/hooks/usePipelineBoard";
import type { DerivedMonth, PlanningAnswers, SeedTask, ThemeRole } from "@/lib/pipeline-year";

export const PIPELINE_YEAR_KEY = (yearId: string) => ["pipeline-year", yearId] as const;

function invalidate(qc: QueryClient, yearId: string) {
  qc.invalidateQueries({ queryKey: PIPELINE_YEAR_KEY(yearId) });
  qc.invalidateQueries({ queryKey: PIPELINE_BOARD_KEY }); // hours/progress/comb on the card move too
}

export interface SchoolYearMonth {
  month_no: number;
  theme: string;
  role: ThemeRole;
  starts_on: string;
  closed_at: string | null;
  closed_by: string | null;
}

export interface SchoolYearTask {
  id: string;
  month_no: number;
  home_month_no: number;
  label: string;
  side: "us" | "school";
  state: "planned" | "scheduled" | "done";
  due_date: string | null;
  est_hours: number | null;
  department_id: string | null;
  departmentName: string | null;
  assignee_id: string | null;
  assigneeName: string | null;
  source: string;
  service_id: string | null;
  ordinal: number;
  is_gate: boolean;
  moved_at: string | null;
  moved_by: string | null;
  movedByName: string | null;
  done_at: string | null;
  done_by: string | null;
  brief_id: string | null;
  client_approval_id: string | null;
}

export interface SchoolYearDetail {
  id: string;
  clientId: string;
  clientName: string;
  town: string | null;
  templateId: string;
  startedOn: string;
  openDays: string[];
  planningAnswers: Json;
  accountOwnerId: string | null;
  plannedBy: string | null;
  completedAt: string | null;
  months: SchoolYearMonth[];
  tasks: SchoolYearTask[];
}

/** One year: the months, the tasks (with department/assignee names resolved
 *  for the planner's cards), and the client it belongs to. */
export function useSchoolYear(yearId: string | undefined) {
  return useQuery({
    queryKey: PIPELINE_YEAR_KEY(yearId ?? ""),
    enabled: !!yearId,
    queryFn: async (): Promise<SchoolYearDetail> => {
      const { data: year, error: yearErr } = await supabase
        .from("school_years")
        .select(
          `id, client_id, template_id, started_on, open_days, planning_answers,
           account_owner_id, planned_by, completed_at,
           client:clients(name, town),
           months:school_year_months(month_no, theme, role, starts_on, closed_at, closed_by)`,
        )
        .eq("id", yearId!)
        .single();
      if (yearErr) throw new Error(errorMessage(yearErr));

      const { data: tasks, error: tasksErr } = await supabase
        .from("school_tasks")
        .select(
          `id, month_no, home_month_no, label, side, state, due_date, est_hours,
           department_id, assignee_id, source, service_id, ordinal, is_gate, moved_at, moved_by,
           done_at, done_by, brief_id, client_approval_id,
           department:departments(name),
           assignee:team_members!school_tasks_assignee_id_fkey(full_name),
           moved_by_member:team_members!school_tasks_moved_by_fkey(full_name)`,
        )
        .eq("year_id", yearId!)
        .order("month_no")
        .order("ordinal");
      if (tasksErr) throw new Error(errorMessage(tasksErr));

      return {
        id: year.id,
        clientId: year.client_id,
        clientName: year.client?.name ?? "",
        town: year.client?.town ?? null,
        templateId: year.template_id,
        startedOn: year.started_on,
        openDays: year.open_days,
        planningAnswers: year.planning_answers,
        accountOwnerId: year.account_owner_id,
        plannedBy: year.planned_by,
        completedAt: year.completed_at,
        months: (year.months ?? []) as SchoolYearMonth[],
        tasks: (tasks ?? []).map(
          (t): SchoolYearTask => ({
            id: t.id,
            month_no: t.month_no,
            home_month_no: t.home_month_no,
            label: t.label,
            side: t.side as "us" | "school",
            state: t.state as "planned" | "scheduled" | "done",
            due_date: t.due_date,
            est_hours: t.est_hours,
            department_id: t.department_id,
            departmentName: t.department?.name ?? null,
            assignee_id: t.assignee_id,
            assigneeName: t.assignee?.full_name ?? null,
            source: t.source,
            service_id: t.service_id,
            ordinal: t.ordinal,
            is_gate: t.is_gate,
            moved_at: t.moved_at,
            moved_by: t.moved_by,
            movedByName: t.moved_by_member?.full_name ?? null,
            done_at: t.done_at,
            done_by: t.done_by,
            brief_id: t.brief_id,
            client_approval_id: t.client_approval_id,
          }),
        ),
      };
    },
  });
}

/** Atomic create via the RPC (0150 §7) — never insert the year/months/tasks
 *  as three separate writes from the browser. p_months/p_tasks come straight
 *  off deriveMonths()/seedTasks() in src/lib/pipeline-year.ts. */
export function useCreateSchoolYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      clientId: string;
      templateId: string;
      startedOn: string;
      openDays: string[];
      answers: PlanningAnswers;
      accountOwnerId: string | null;
      months: DerivedMonth[];
      tasks: SeedTask[];
    }): Promise<string> => {
      const { data, error } = await supabase.rpc("create_school_year", {
        p_client_id: input.clientId,
        p_template_id: input.templateId,
        p_started_on: input.startedOn,
        p_open_days: input.openDays,
        p_answers: input.answers as unknown as Json,
        // school_years.account_owner_id is nullable; the generated Args type
        // just doesn't say so (a types-gen gap, same as elsewhere in the repo).
        p_account_owner_id: input.accountOwnerId as unknown as string,
        p_months: input.months as unknown as Json,
        p_tasks: input.tasks as unknown as Json,
      });
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PIPELINE_BOARD_KEY }),
  });
}

/** Re-runs the planning session: re-themes the FUTURE open months and
 *  replaces only the untouched template tasks in them (0150 §"Delta D") —
 *  never the closed/current month, never a task someone moved. */
export function useReplanSchoolYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      yearId: string;
      openDays: string[];
      answers: PlanningAnswers;
      months: DerivedMonth[];
      tasks: SeedTask[];
    }) => {
      const { error } = await supabase.rpc("replan_school_year", {
        p_year_id: input.yearId,
        p_open_days: input.openDays,
        p_answers: input.answers as unknown as Json,
        p_months: input.months as unknown as Json,
        p_tasks: input.tasks as unknown as Json,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.yearId),
  });
}

/** Drag or click-to-move both land here: `month_no` is the ONLY column this
 *  writes. State, due_date, moved_by and moved_at are tg_school_tasks_guard's
 *  job — writing them here too would be the two-sources-for-one-truth
 *  failure this repo already audits itself for. Legality (closed month, done
 *  task) is pipeline-move.ts's moveLegality() as a pre-flight UI check; the
 *  trigger is the actual gate and this call can still come back refused. */
export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    // yearId isn't written here — it's only the optimistic-cache key below.
    mutationFn: async (vars: { yearId: string; taskId: string; toMonth: number }) => {
      const { error } = await supabase.from("school_tasks").update({ month_no: vars.toMonth }).eq("id", vars.taskId);
      if (error) throw new Error(errorMessage(error));
    },
    // Optimistic so the column a card is dropped into re-totals its hours
    // immediately, not after a round trip.
    onMutate: async ({ yearId, taskId, toMonth }) => {
      await qc.cancelQueries({ queryKey: PIPELINE_YEAR_KEY(yearId) });
      const previous = qc.getQueryData<SchoolYearDetail>(PIPELINE_YEAR_KEY(yearId));
      if (previous) {
        qc.setQueryData<SchoolYearDetail>(PIPELINE_YEAR_KEY(yearId), {
          ...previous,
          tasks: previous.tasks.map((t) => (t.id === taskId ? { ...t, month_no: toMonth } : t)),
        });
      }
      return { previous };
    },
    onError: (_err, { yearId }, ctx) => {
      if (ctx?.previous) qc.setQueryData(PIPELINE_YEAR_KEY(yearId), ctx.previous);
    },
    // Always refetch on settle — the optimistic row is missing the
    // trigger-derived state/due_date the server actually landed on.
    onSettled: (_d, _e, vars) => invalidate(qc, vars.yearId),
  });
}

/** Our tasks only — the school's side closes by their client_approvals
 *  decision settling (0150's tg_school_task_follows_approval), never by a
 *  tick here. The call site is responsible for only showing the checkbox on
 *  side === 'us' rows. */
export function useToggleTaskDone() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();
  return useMutation({
    // yearId isn't written here either — same reason as useMoveTask above.
    mutationFn: async (vars: { yearId: string; taskId: string; done: boolean }) => {
      const { error } = await supabase
        .from("school_tasks")
        .update(
          vars.done
            ? { state: "done", done_at: new Date().toISOString(), done_by: currentUserId ?? null }
            : { state: "scheduled", done_at: null, done_by: null },
        )
        .eq("id", vars.taskId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.yearId),
  });
}

/** Closes the current month via the RPC: stamps it, schedules month+1 with
 *  real dates and its client asks, and on month 12 ends the year. Refuses
 *  (see 0150 §6) if any task in the month is not yet 'done' — the confirm
 *  dialog's job is confirmation, not validation. */
export function useCloseMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ yearId, monthNo }: { yearId: string; monthNo: number }) => {
      const { error } = await supabase.rpc("close_school_year_month", { p_year_id: yearId, p_month_no: monthNo });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.yearId),
  });
}

/** The mirror — only the most recently closed month reopens (0150 §6). */
export function useReopenMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ yearId, monthNo }: { yearId: string; monthNo: number }) => {
      const { error } = await supabase.rpc("reopen_school_year_month", { p_year_id: yearId, p_month_no: monthNo });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.yearId),
  });
}

/** D2: the single surface a task's est_hours is editable — the drawer's task
 *  row (TaskCard on the planner is the drag pick-up target, not an editor).
 *  Writes est_hours only, same shape as every other single-column mutation
 *  in this file. */
export function useSetTaskHours() {
  const qc = useQueryClient();
  return useMutation({
    // yearId isn't written here — it's only the invalidate() cache key below.
    mutationFn: async ({ taskId, hours }: { yearId: string; taskId: string; hours: number | null }) => {
      const { error } = await supabase.from("school_tasks").update({ est_hours: hours }).eq("id", taskId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.yearId),
  });
}

/** "+ Add a service": copies a service's top-level process_steps in as
 *  'us'-side tasks, department resolved from the service's rule (highest-pct
 *  allocation, ties broken by the department's own display_order; null with
 *  no rule). state stays 'planned'/due_date null on the write — if monthNo
 *  is the school's current month, tg_school_tasks_guard's INSERT branch
 *  (0151, D5) promotes it to 'scheduled' with a real date before it lands;
 *  a future month is untouched and stays 'planned' until it arrives. */
export function useAddServiceToMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ yearId, monthNo, serviceId }: { yearId: string; monthNo: number; serviceId: string }) => {
      const { data: service, error: serviceErr } = await supabase
        .from("services")
        .select("rule_id")
        .eq("id", serviceId)
        .single();
      if (serviceErr) throw new Error(errorMessage(serviceErr));

      let departmentId: string | null = null;
      if (service.rule_id) {
        const { data: allocations, error: allocErr } = await supabase
          .from("rule_allocations")
          .select("department_id, pct, department:departments(display_order)")
          .eq("rule_id", service.rule_id);
        if (allocErr) throw new Error(errorMessage(allocErr));
        const top = [...(allocations ?? [])].sort((a, b) => {
          if (b.pct !== a.pct) return b.pct - a.pct;
          return (a.department?.display_order ?? 0) - (b.department?.display_order ?? 0);
        })[0];
        departmentId = top?.department_id ?? null;
      }

      const { data: steps, error: stepsErr } = await supabase
        .from("process_steps")
        .select("title, estimated_hours")
        .eq("service_id", serviceId)
        .is("parent_id", null)
        .order("ordinal");
      if (stepsErr) throw new Error(errorMessage(stepsErr));
      if (!steps || steps.length === 0) return;

      const { error: insertErr } = await supabase.from("school_tasks").insert(
        steps.map((s, i) => ({
          year_id: yearId,
          month_no: monthNo,
          home_month_no: monthNo,
          label: s.title,
          side: "us" as const,
          department_id: departmentId,
          est_hours: s.estimated_hours,
          source: "service" as const,
          service_id: serviceId,
          state: "planned" as const,
          due_date: null,
          ordinal: i,
        })),
      );
      if (insertErr) throw new Error(errorMessage(insertErr));
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.yearId),
  });
}
