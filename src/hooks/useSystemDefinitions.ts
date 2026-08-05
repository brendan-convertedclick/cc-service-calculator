import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type SystemDefinition = Database["public"]["Tables"]["system_definitions"]["Row"];
type SystemDefinitionInsert = Database["public"]["Tables"]["system_definitions"]["Insert"];
type SystemDefinitionUpdate = Database["public"]["Tables"]["system_definitions"]["Update"];

export const SYSTEMS_KEY = ["system_definitions"] as const;
export const SYSTEM_DETAIL_KEY = (id: string) => [...SYSTEMS_KEY, id] as const;

// 0105 backfill stamped every pre-existing system with this placeholder —
// systems still carrying it have never had a real goal set. Surfaced as
// "unmapped" in the list; never blocks materialisation (see spec Phase 4).
export const PLACEHOLDER_GOAL = "TODO: set a goal for this system";

// `band` is a free-text column (spec: attract | convert | deliver | retain |
// internal), not a DB enum — shared here so SystemsList and SystemDetail agree
// on the same five buckets instead of drifting.
export const SYSTEM_BANDS = ["attract", "convert", "deliver", "retain", "internal"] as const;
export type SystemBand = (typeof SYSTEM_BANDS)[number];
export const SYSTEM_BAND_LABEL: Record<SystemBand, string> = {
  attract: "Attract",
  convert: "Convert",
  deliver: "Deliver",
  retain: "Retain",
  internal: "Internal",
};

export const SYSTEM_KIND_LABEL: Record<Database["public"]["Enums"]["system_kind"], string> = {
  service: "Service",
  recurring: "Recurring",
  internal: "Internal",
  reference: "Reference",
};

// Shared between SystemDetail's steps list and BlockInspector's editable
// select — one label map, not two.
export const MATERIALISE_LABEL: Record<Database["public"]["Enums"]["materialise_mode"], string> = {
  task: "Task",
  checklist_item: "Checklist item",
  none: "Not materialised",
};

export type SystemDefinitionWithJoins = SystemDefinition & {
  service_name: string | null;
  recurring_service_name: string | null;
  time_category_label: string | null;
  owner_name: string | null;
  expert_name: string | null;
  step_count: number;
};

type JoinedRow = SystemDefinition & {
  owner: { full_name: string } | null;
  expert: { full_name: string } | null;
  service: { name: string } | null;
  recurring_service: { service: { name: string } | null } | null;
  time_category: { label: string } | null;
};

const JOIN_SELECT =
  "*, owner:team_members!system_definitions_owner_id_fkey(full_name), expert:team_members!system_definitions_expert_id_fkey(full_name), service:services(name), recurring_service:retainer_recurring_services(service:services(name)), time_category:time_categories(label)";

function withJoins(s: JoinedRow): SystemDefinitionWithJoins {
  return {
    ...s,
    service_name: s.service?.name ?? null,
    recurring_service_name: s.recurring_service?.service?.name ?? null,
    time_category_label: s.time_category?.label ?? null,
    owner_name: s.owner?.full_name ?? null,
    expert_name: s.expert?.full_name ?? null,
    step_count: 0, // filled in by useSystemDefinitions; useSystemDefinition doesn't need it
  };
}

// All non-archived systems + joined names and a top-level step count. Step
// count is a second cheap query rather than a DB-side aggregate — PostgREST
// has no group-by-count in a single embedded request, and this mirrors how
// useServices/useAllocationMatrix already split "rows" from "derived totals".
export function useSystemDefinitions() {
  return useQuery({
    queryKey: SYSTEMS_KEY,
    queryFn: async (): Promise<SystemDefinitionWithJoins[]> => {
      const [{ data: systems, error }, { data: stepRows, error: sErr }] = await Promise.all([
        supabase.from("system_definitions").select(JOIN_SELECT).is("archived_at", null).order("name"),
        supabase.from("process_steps").select("system_id").is("parent_id", null).not("system_id", "is", null),
      ]);
      if (error) throw error;
      if (sErr) throw sErr;

      const counts = new Map<string, number>();
      for (const r of (stepRows ?? []) as { system_id: string }[]) {
        counts.set(r.system_id, (counts.get(r.system_id) ?? 0) + 1);
      }

      return ((systems ?? []) as unknown as JoinedRow[]).map((s) => ({
        ...withJoins(s),
        step_count: counts.get(s.id) ?? 0,
      }));
    },
  });
}

// One system + its joined names. Steps are deliberately NOT fetched here —
// use useSystemSteps(id) from useProcessSteps.ts alongside this. That hook's
// mutations invalidate the ["process_steps"] prefix (the C3 fix); bundling
// steps into this query under the ["system_definitions", id] key would put
// them outside that invalidation and go stale after any step edit.
export function useSystemDefinition(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? SYSTEM_DETAIL_KEY(id) : [...SYSTEMS_KEY, "none"],
    queryFn: async (): Promise<SystemDefinitionWithJoins | null> => {
      if (!id) return null;
      const { data, error } = await supabase.from("system_definitions").select(JOIN_SELECT).eq("id", id).single();
      if (error) throw error;
      return withJoins(data as unknown as JoinedRow);
    },
  });
}

export function useCreateSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SystemDefinitionInsert) => {
      const { data, error } = await supabase.from("system_definitions").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SYSTEMS_KEY }),
  });
}

export function useUpdateSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: SystemDefinitionUpdate }) => {
      const { data, error } = await supabase.from("system_definitions").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: SYSTEMS_KEY });
      qc.invalidateQueries({ queryKey: SYSTEM_DETAIL_KEY(vars.id) });
    },
  });
}

// kind='internal' only: total actual hours attributed to this system's time
// category, across every team member's perpetual [Internal] task for it.
// ongoing_actuals_current is DISTINCT ON (ongoing_task_id) latest cumulative_hours
// per task (confirmed via pg_get_viewdef) — summing across tasks for the
// category is the correct "total consumed", not a running-period delta.
export function useSystemOverhead(timeCategoryId: string | null | undefined) {
  return useQuery({
    enabled: !!timeCategoryId,
    queryKey: ["system-overhead", timeCategoryId ?? "none"],
    queryFn: async (): Promise<number> => {
      if (!timeCategoryId) return 0;
      const { data: tasks, error } = await supabase
        .from("ongoing_tasks")
        .select("id")
        .eq("time_category_id", timeCategoryId)
        .is("archived_at", null);
      if (error) throw error;
      const ids = (tasks ?? []).map((t) => t.id);
      if (ids.length === 0) return 0;

      const { data: actuals, error: aErr } = await supabase
        .from("ongoing_actuals_current")
        .select("cumulative_hours")
        .in("ongoing_task_id", ids);
      if (aErr) throw aErr;
      return (actuals ?? []).reduce((sum, a) => sum + Number(a.cumulative_hours ?? 0), 0);
    },
  });
}

// retainer_recurring_services isn't in the generated Database types yet
// (Phase 8, see useRetainerServices.ts) — query untyped, same as that hook.
// Only used to populate the "New system" dialog's kind='recurring' picker.
export type RecurringServiceOption = { id: string; label: string };

export function useRecurringServiceOptions() {
  return useQuery({
    queryKey: ["recurring-service-options"],
    queryFn: async (): Promise<RecurringServiceOption[]> => {
      const sb = supabase as unknown as SupabaseClient;
      const { data, error } = await sb
        .from("retainer_recurring_services")
        .select("id, cadence, service:services(name), project:projects(name, client:clients(name))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      type Row = {
        id: string;
        cadence: string;
        service: { name: string } | null;
        project: { name: string | null; client: { name: string } | null } | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        label: `${r.project?.client?.name ?? "?"} · ${r.service?.name ?? "Recurring service"} (${r.cadence})`,
      }));
    },
  });
}
