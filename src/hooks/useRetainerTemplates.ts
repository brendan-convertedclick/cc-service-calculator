// Reusable retainer shapes (0166).
//
// A template is the SERVICE LIST and nothing else — no fee, no hours target, no
// client, no assignees. Those belong to an agreement and to a person; copying
// them between clients is how a template starts telling lies. The wizard still
// asks for all four every time.
//
// It exists because the same shapes are already being retyped: the Monthly
// Feedback Meeting + Update Meeting Agenda pair sits on 4–5 clients and has
// already drifted (1×2pt on one, 1×4pt on another) purely from hand entry, and
// the five School Strategy social services are an identical bundle on three.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** The timing fields a recurring service needs to land on the right day.
 *  Added in 0167: without them a template of routines ("every Monday", "due the
 *  15th") applies as five undated tasks, which looks like it worked. */
export interface TemplateShape {
  occurrence_labels: string[];
  occurrence_start_days: number[];
  occurrence_due_days: number[];
  label_as_task_name: boolean;
  roll_up_monthly: boolean;
  recur_weekday: number | null;
  task_description: string | null;
  checklist_items: string[];
}

export interface TemplateService extends TemplateShape {
  service_id: string;
  service_name: string;
  cadence: string;
  occurrences_per_month: number;
  points_per_occurrence: number;
  is_live_eligible: boolean;
}

const SHAPE_COLUMNS =
  "occurrence_labels, occurrence_start_days, occurrence_due_days, label_as_task_name, roll_up_monthly, recur_weekday, task_description, checklist_items";

export interface RetainerTemplate {
  id: string;
  name: string;
  notes: string | null;
  isInternal: boolean;
  services: TemplateService[];
  /** Hours a month the shape adds up to — the one derived figure worth showing
   *  when picking, since it is what the retainer will schedule. */
  monthlyHours: number;
}

const HOURS_PER_POINT = 0.25;

export function useRetainerTemplates() {
  return useQuery({
    queryKey: ["retainer_templates"],
    queryFn: async (): Promise<RetainerTemplate[]> => {
      const { data, error } = await supabase
        .from("retainer_templates")
        .select(
          `id, name, notes, is_internal, retainer_template_services(service_id, cadence, occurrences_per_month, points_per_occurrence, is_live_eligible, sort_order, ${SHAPE_COLUMNS}, services(name))`,
        )
        .is("archived_at", null)
        .order("name");
      if (error) throw error;

      return ((data ?? []) as unknown as Array<{
        id: string;
        name: string;
        notes: string | null;
        is_internal: boolean;
        retainer_template_services: Array<TemplateShape & {
          service_id: string;
          cadence: string;
          occurrences_per_month: number;
          points_per_occurrence: number;
          is_live_eligible: boolean;
          sort_order: number;
          services: { name: string } | null;
        }>;
      }>).map((t) => {
        const services = [...(t.retainer_template_services ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((s) => ({
            service_id: s.service_id,
            service_name: s.services?.name ?? "Service",
            cadence: s.cadence,
            occurrences_per_month: Number(s.occurrences_per_month),
            points_per_occurrence: Number(s.points_per_occurrence),
            is_live_eligible: s.is_live_eligible,
            occurrence_labels: s.occurrence_labels ?? [],
            occurrence_start_days: s.occurrence_start_days ?? [],
            occurrence_due_days: s.occurrence_due_days ?? [],
            label_as_task_name: s.label_as_task_name ?? false,
            roll_up_monthly: s.roll_up_monthly ?? false,
            recur_weekday: s.recur_weekday ?? null,
            task_description: s.task_description ?? null,
            checklist_items: s.checklist_items ?? [],
          }));
        return {
          id: t.id,
          name: t.name,
          notes: t.notes,
          isInternal: t.is_internal,
          services,
          monthlyHours: services.reduce(
            (n, s) => n + s.occurrences_per_month * s.points_per_occurrence * HOURS_PER_POINT,
            0,
          ),
        };
      });
    },
  });
}

export interface SaveTemplateInput {
  name: string;
  isInternal: boolean;
  services: Array<Partial<TemplateShape> & {
    service_id: string;
    cadence: string;
    occurrences_per_month: number;
    points_per_occurrence: number;
    is_live_eligible: boolean;
  }>;
}

/** Capture a retainer's shape as a template. */
export function useSaveRetainerTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveTemplateInput): Promise<string> => {
      if (!input.name.trim()) throw new Error("A template needs a name.");
      if (input.services.length === 0) {
        // A template with no services would silently produce an empty retainer,
        // and create-retainer refuses one of those anyway.
        throw new Error("This retainer has no recurring services to save.");
      }
      const { data, error } = await supabase
        .from("retainer_templates")
        .insert({ name: input.name.trim(), is_internal: input.isInternal })
        .select("id")
        .single();
      if (error) throw error;
      const templateId = (data as { id: string }).id;

      const { error: svcErr } = await supabase.from("retainer_template_services").insert(
        input.services.map((s, i) => ({ ...s, template_id: templateId, sort_order: i })),
      );
      if (svcErr) {
        // Roll back rather than leave a named template that produces nothing —
        // it would look usable in the picker and create an empty retainer.
        await supabase.from("retainer_templates").delete().eq("id", templateId);
        throw svcErr;
      }
      return templateId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retainer_templates"] }),
  });
}
