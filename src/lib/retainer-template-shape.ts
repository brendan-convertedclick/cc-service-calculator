// The trip a retainer template has to survive: a stored template → a row in the
// New Retainer wizard → the create-retainer payload.
//
// It lives here rather than inline in the wizard because the whole failure mode
// is a field being silently dropped. Before 0167 the timing fields fell out at
// the first step, so "New Schools Monthly Tasks Retainer" applied to a new
// school as seven undated tasks — which looks exactly like it worked. A render
// test would not notice that; asserting these two functions does.
import type { TemplateService, TemplateShape } from "@/hooks/useRetainerTemplates";

/** The template row's timing half, lifted off a service. */
export function shapeOf(s: TemplateService): TemplateShape {
  return {
    occurrence_labels: s.occurrence_labels,
    occurrence_start_days: s.occurrence_start_days,
    occurrence_due_days: s.occurrence_due_days,
    label_as_task_name: s.label_as_task_name,
    roll_up_monthly: s.roll_up_monthly,
    recur_weekday: s.recur_weekday,
    task_description: s.task_description,
    checklist_items: s.checklist_items,
  };
}

export interface WizardRowFromTemplate {
  service_id: string;
  cadence: string;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
  shape: TemplateShape;
}

/** A template service as a wizard row. Assignees stay empty on purpose: who does
 *  the work is a fact about this client and this person, and carrying one
 *  client's names onto another is how a template produces tasks for the wrong
 *  people (0166). */
export function rowFromTemplateService(s: TemplateService): WizardRowFromTemplate {
  return {
    service_id: s.service_id,
    cadence: s.cadence,
    occurrences_per_month: s.occurrences_per_month,
    points_per_occurrence: s.points_per_occurrence,
    default_assignees: [],
    is_live_eligible: s.is_live_eligible,
    shape: shapeOf(s),
  };
}

/** A wizard row as one entry in create-retainer's `services` array — the shape
 *  flattened back out beside the rest. */
export function payloadFromRow<
  T extends { shape?: Partial<TemplateShape> },
>(row: T): Omit<T, "shape"> & Partial<TemplateShape> {
  const { shape, ...rest } = row;
  return { ...rest, ...(shape ?? {}) };
}
