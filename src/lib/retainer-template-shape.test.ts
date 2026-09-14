import { describe, it, expect } from "vitest";
import { rowFromTemplateService, payloadFromRow } from "./retainer-template-shape";
import type { TemplateService } from "@/hooks/useRetainerTemplates";

// These import the functions NewRetainerWizard actually calls. That is the
// point: the failure this guards against is a timing field being quietly
// dropped between the template and create-retainer, and a test that re-declared
// its own copy of the mapping would stay green while the wizard broke.

const dailyRhythmWed: TemplateService = {
  service_id: "svc-wed",
  service_name: "Schools Account Owner — Daily Rhythm (Wed)",
  cadence: "weekly",
  occurrences_per_month: 4,
  points_per_occurrence: 2,
  is_live_eligible: false,
  occurrence_labels: [],
  occurrence_start_days: [],
  occurrence_due_days: [],
  label_as_task_name: false,
  roll_up_monthly: false,
  recur_weekday: 3,
  task_description: null,
  checklist_items: [],
};

const midMonth: TemplateService = {
  ...dailyRhythmWed,
  service_id: "svc-mid",
  service_name: "Schools Account Owner — Mid-Month Check (Day 15)",
  cadence: "monthly",
  occurrences_per_month: 1,
  points_per_occurrence: 4,
  recur_weekday: null,
  occurrence_due_days: [15],
};

const send = (s: TemplateService) => payloadFromRow(rowFromTemplateService(s));

describe("a template survives the trip to create-retainer", () => {
  it("keeps the weekday a routine repeats on", () => {
    expect(send(dailyRhythmWed).recur_weekday).toBe(3);
  });

  it("keeps the day of the month a task is due", () => {
    expect(send(midMonth).occurrence_due_days).toEqual([15]);
  });

  it("never promotes a template's services to live tracking", () => {
    // is_live_eligible defaults true in the database and every team member is
    // on live tracking, so a true here collapses a month of dated tasks into
    // one perpetual [Live] task and the recurrence disappears with no error.
    expect(send(dailyRhythmWed).is_live_eligible).toBe(false);
  });

  it("carries no assignee — that belongs to the client, not the shape", () => {
    expect(send(dailyRhythmWed).default_assignees).toEqual([]);
  });

  it("leaves month-end services with no due day, so February is not wrong", () => {
    // Empty means the provisioner uses the real last day of the period. A
    // literal 30 would be a lie in February and a day early in March.
    expect(send({ ...midMonth, occurrence_due_days: [] }).occurrence_due_days).toEqual([]);
  });

  it("sends no `shape` key of its own — the server reads flat fields", () => {
    expect(send(midMonth)).not.toHaveProperty("shape");
  });

  it("carries every timing field, so adding one cannot be forgotten here", () => {
    // Guards the drop this whole file exists for: if a column is added to
    // TemplateShape and the mapper is not updated, this fails.
    const sent = send(dailyRhythmWed);
    for (const k of [
      "occurrence_labels",
      "occurrence_start_days",
      "occurrence_due_days",
      "label_as_task_name",
      "roll_up_monthly",
      "recur_weekday",
      "task_description",
      "checklist_items",
    ]) {
      expect(sent).toHaveProperty(k);
    }
  });
});
