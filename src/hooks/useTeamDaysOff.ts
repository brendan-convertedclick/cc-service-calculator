// Who is off which day (0172). Read by the capacity page so a day on leave
// is not counted as 7h the team could have worked; written from the same
// page's month grid.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type DayOffKind = "leave" | "sick" | "holiday";

export interface DayOff {
  team_member_id: string;
  day: string; // "YYYY-MM-DD"
  kind: DayOffKind;
  note: string | null;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

export function useTeamDaysOff(month: string) {
  const { start, end } = monthBounds(month);
  return useQuery({
    queryKey: ["team_days_off", month],
    queryFn: async (): Promise<DayOff[]> => {
      const { data, error } = await supabase
        .from("team_days_off")
        .select("team_member_id, day, kind, note")
        .gte("day", start)
        .lt("day", end);
      if (error) throw error;
      return (data ?? []) as DayOff[];
    },
  });
}

/** Set a person's day to a kind, or clear it with null. */
export function useSetDayOff(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { team_member_id: string; day: string; kind: DayOffKind | null }) => {
      if (input.kind === null) {
        const { error } = await supabase
          .from("team_days_off")
          .delete()
          .eq("team_member_id", input.team_member_id)
          .eq("day", input.day);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("team_days_off")
        .upsert(
          { team_member_id: input.team_member_id, day: input.day, kind: input.kind },
          { onConflict: "team_member_id,day" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team_days_off", month] });
    },
  });
}
