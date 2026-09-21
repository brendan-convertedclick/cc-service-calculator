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
  /** 1 = whole day, 0.5 = half (0173). */
  fraction: number;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

/** Days off inside any period, not just a month: a week with leave in it has
 *  less capacity than one without, and that is exactly the week Lisa looks
 *  at. `day` is a plain date column, so the period's local bounds are the
 *  right comparison — no instant conversion here. */
export function useTeamDaysOffBetween(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["team_days_off", startDate, endDate],
    queryFn: async (): Promise<DayOff[]> => {
      const { data, error } = await supabase
        .from("team_days_off")
        .select("team_member_id, day, kind, note, fraction")
        .gte("day", startDate)
        .lt("day", endDate);
      if (error) throw error;
      return (data ?? []) as DayOff[];
    },
  });
}

/** The month-shaped call the days-off grid still makes. */
export function useTeamDaysOff(month: string) {
  const { start, end } = monthBounds(month);
  return useTeamDaysOffBetween(start, end);
}

/** Set a person's day to a kind, or clear it with null.
 *
 *  Takes no period: it invalidates EVERY days-off query, on the prefix alone.
 *  It used to invalidate `["team_days_off", month]`, which stopped matching
 *  the moment the read key became a date range — the write still landed, the
 *  grid never refetched, and a cell looked frozen on its old mark while the
 *  database had already moved on. Keying the invalidation to one period is
 *  the bug; there are only ever a couple of these cached, and a day off can
 *  belong to a month, a week and a day at once. */
export function useSetDayOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      team_member_id: string;
      day: string;
      kind: DayOffKind | null;
      fraction?: number;
    }) => {
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
          { team_member_id: input.team_member_id, day: input.day, kind: input.kind, fraction: input.fraction ?? 1 },
          { onConflict: "team_member_id,day" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team_days_off"] });
    },
  });
}
