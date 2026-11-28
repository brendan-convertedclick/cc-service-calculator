import type { PostgrestError } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { monthsBefore, type TimeType, type TypeHoursRow } from "@/lib/time-types";

// time_type_hours / task_time_types (0217) are not in the generated db types yet.
type PersonRow = TypeHoursRow & { clickup_user_id: number | null };
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => { range: (a: number, b: number) => PromiseLike<{ data: PersonRow[] | null; error: PostgrestError | null }> };

const startOf = (m: string) => `${m}-01T00:00:00+02:00`;

// PostgREST stops at 1,000 rows without saying so; a month is several hundred
// task rows and the per-person grain is more.
async function fetchAll(args: Record<string, unknown>) {
  const out: PersonRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await rpc("time_type_hours", args).range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

/** Logged hours per task per month with their type, from `first` to the end of `last`. */
export function useTimeTypes(first: string, last: string) {
  return useQuery({
    queryKey: ["time_types", first, last],
    queryFn: () => fetchAll({ p_start: startOf(first), p_end: startOf(monthsBefore(last, -1)) }),
  });
}

/** One month per person. The database refuses this to anyone but admin and owner. */
export function useTimeTypesByPerson(month: string, enabled: boolean) {
  return useQuery({
    queryKey: ["time_types_by_person", month],
    enabled,
    queryFn: async () => {
      const [rows, team] = await Promise.all([
        fetchAll({ p_start: startOf(month), p_end: startOf(monthsBefore(month, -1)), p_by_person: true }),
        supabase.from("team_members").select("full_name, clickup_user_id").not("clickup_user_id", "is", null),
      ]);
      if (team.error) throw team.error;
      const names = new Map((team.data ?? []).map((t) => [Number(t.clickup_user_id), t.full_name as string]));
      return rows.map((r) => ({ ...r, person: names.get(Number(r.clickup_user_id)) ?? "Someone not on the team" }));
    },
  });
}

type Untyped = {
  from: (t: string) => {
    upsert: (v: object, o: object) => PromiseLike<{ error: PostgrestError | null }>;
    delete: () => { eq: (col: string, v: string) => PromiseLike<{ error: PostgrestError | null }> };
  };
};

/** Set a task's type by hand, or clear it (null) so the rules decide again. Holds for all its future time. */
export function useSetTaskTimeType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, type, by }: { taskId: string; type: Exclude<TimeType, "unclassified"> | null; by: string | null }) => {
      const t = (supabase as unknown as Untyped).from("task_time_types");
      const { error } = type
        ? await t.upsert({ clickup_task_id: taskId, time_type: type, set_by: by, set_at: new Date().toISOString() }, { onConflict: "clickup_task_id" })
        : await t.delete().eq("clickup_task_id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time_types"] });
      qc.invalidateQueries({ queryKey: ["time_types_by_person"] });
    },
  });
}
