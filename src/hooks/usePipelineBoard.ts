// src/hooks/usePipelineBoard.ts
//
// The Journey board's one read (/pipeline) plus the two mutations the board
// itself performs — flagging a client as a school and setting an account
// owner. Everything else (planning, moving, closing months) lives on a
// single school's year and is in useSchoolYear.ts.
//
// One flat fetch per query, never one per card — ponytail: fine at ~14
// schools today; page it (or move to a view) if the vertical grows past a
// hundred.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import type { Database } from "@/types/db";
import {
  currentMonthNo,
  hoursByMonth,
  lateCounts,
  monthProgress,
  type MonthLike,
  type TaskLike,
} from "@/lib/pipeline-move";
import type { TemplateTask, TemplateTheme, ThemeRole } from "@/lib/pipeline-year";

export const PIPELINE_BOARD_KEY = ["pipeline-board"] as const;
export const PIPELINE_TEMPLATE_KEY = ["pipeline-template"] as const;

export interface BoardMonth {
  month_no: number;
  theme: string;
  role: ThemeRole;
  starts_on: string;
  closed_at: string | null;
}

/** One card. `yearId: null` is the leading "Not started" column. */
export interface BoardSchool {
  clientId: string;
  clientName: string;
  town: string | null;
  yearId: string | null;
  accountOwnerId: string | null;
  months: BoardMonth[]; // [] when there is no active year — the comb has nothing to draw
  currentMonthNo: number | null; // null with no year, or once every month is closed
  currentTheme: string | null;
  progress: { done: number; total: number };
  hoursThisMonth: number;
  late: { ours: number; theirs: number };
}

type BoardTaskRow = {
  year_id: string;
  id: string;
  month_no: number;
  side: string;
  state: string;
  due_date: string | null;
  est_hours: number | null;
};

/** Every school on the board, one card each, three reads in one Promise.all. */
export function usePipelineBoard() {
  return useQuery({
    queryKey: PIPELINE_BOARD_KEY,
    queryFn: async (): Promise<BoardSchool[]> => {
      const [clientsRes, yearsRes] = await Promise.all([
        supabase.from("clients").select("id, name, town").eq("is_school", true).is("archived_at", null),
        supabase
          .from("school_years")
          .select(
            "id, client_id, account_owner_id, months:school_year_months(month_no, theme, role, starts_on, closed_at)",
          )
          .is("completed_at", null),
      ]);
      if (clientsRes.error) throw new Error(errorMessage(clientsRes.error));
      if (yearsRes.error) throw new Error(errorMessage(yearsRes.error));
      const clients = clientsRes.data ?? [];
      const years = yearsRes.data ?? [];

      const yearIds = years.map((y) => y.id);
      const tasksRes = yearIds.length
        ? await supabase
            .from("school_tasks")
            .select("year_id, id, month_no, side, state, due_date, est_hours")
            .in("year_id", yearIds)
        : { data: [] as BoardTaskRow[], error: null };
      if (tasksRes.error) throw new Error(errorMessage(tasksRes.error));

      const yearByClient = new Map(years.map((y) => [y.client_id, y]));
      const tasksByYear = new Map<string, BoardTaskRow[]>();
      for (const t of tasksRes.data ?? []) {
        const list = tasksByYear.get(t.year_id);
        if (list) list.push(t);
        else tasksByYear.set(t.year_id, [t]);
      }

      return clients.map((c): BoardSchool => {
        const year = yearByClient.get(c.id);
        if (!year) {
          return {
            clientId: c.id,
            clientName: c.name,
            town: c.town,
            yearId: null,
            accountOwnerId: null,
            months: [],
            currentMonthNo: null,
            currentTheme: null,
            progress: { done: 0, total: 0 },
            hoursThisMonth: 0,
            late: { ours: 0, theirs: 0 },
          };
        }
        const months = (year.months ?? []) as BoardMonth[];
        const yearTasks = tasksByYear.get(year.id) ?? [];
        const cur = currentMonthNo(months as MonthLike[]);
        return {
          clientId: c.id,
          clientName: c.name,
          town: c.town,
          yearId: year.id,
          accountOwnerId: year.account_owner_id,
          months,
          currentMonthNo: cur,
          currentTheme: months.find((m) => m.month_no === cur)?.theme ?? null,
          progress: cur ? monthProgress(yearTasks as TaskLike[], cur) : { done: 0, total: 0 },
          hoursThisMonth: cur ? (hoursByMonth(yearTasks).get(cur) ?? 0) : 0,
          late: lateCounts(yearTasks as { side: "us" | "school"; state: string; due_date: string | null }[]),
        };
      });
    },
  });
}

/** The default template's themes + tasks — feeds the planning dialog's live
 *  preview (deriveMonths/seedTasks). `null` when settings has none set. */
export function usePipelineTemplate() {
  return useQuery({
    queryKey: PIPELINE_TEMPLATE_KEY,
    queryFn: async (): Promise<{ templateId: string; themes: TemplateTheme[]; tasks: TemplateTask[] } | null> => {
      const { data: settings, error: settingsErr } = await supabase
        .from("settings")
        .select("default_pipeline_template_id")
        .eq("id", 1)
        .single();
      if (settingsErr) throw new Error(errorMessage(settingsErr));
      const templateId = settings.default_pipeline_template_id;
      if (!templateId) return null;

      const { data: themes, error: themesErr } = await supabase
        .from("pipeline_template_themes")
        .select("id, theme, role, pinned_month, ordinal")
        .eq("template_id", templateId)
        .order("ordinal");
      if (themesErr) throw new Error(errorMessage(themesErr));

      const themeIds = (themes ?? []).map((t) => t.id);
      const { data: tasks, error: tasksErr } = themeIds.length
        ? await supabase
            .from("pipeline_template_tasks")
            .select("theme_id, label, side, department_id, est_hours, ordinal, is_gate")
            .in("theme_id", themeIds)
            .order("ordinal")
        : { data: [], error: null };
      if (tasksErr) throw new Error(errorMessage(tasksErr));

      return {
        templateId,
        themes: (themes ?? []) as TemplateTheme[],
        tasks: (tasks ?? []) as TemplateTask[],
      };
    },
  });
}

/** "Add a school": flags an existing client, captures the town. There is no
 *  other writer of clients.is_school / clients.town — see 0150 §9. */
export function useEnrolSchool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, town }: { clientId: string; town: string }) => {
      const { error } = await supabase
        .from("clients")
        .update({ is_school: true, town: town.trim() } satisfies Database["public"]["Tables"]["clients"]["Update"])
        .eq("id", clientId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PIPELINE_BOARD_KEY }),
  });
}

export function useSetAccountOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ yearId, memberId }: { yearId: string; memberId: string | null }) => {
      const { error } = await supabase.from("school_years").update({ account_owner_id: memberId }).eq("id", yearId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: PIPELINE_BOARD_KEY });
      // Mirrors useSchoolYear.ts's PIPELINE_YEAR_KEY(yearId) — inlined rather
      // than imported to keep these two sibling hook files from importing
      // each other in both directions.
      qc.invalidateQueries({ queryKey: ["pipeline-year", vars.yearId] });
    },
  });
}
