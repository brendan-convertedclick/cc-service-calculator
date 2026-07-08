import { describe, it, expect } from "vitest";
import { draftFromSuggestion } from "./quick-brief-suggestion";

describe("draftFromSuggestion", () => {
  it("uses suggestion values when valid", () => {
    expect(draftFromSuggestion(
      { task_name: "Pull report", work_stream: "Reporting", sprint_points: 4, due_date: "2026-07-15" },
      "Re: report",
    )).toEqual({ task_name: "Pull report", work_stream: "Reporting", sprint_points: 4, due_date: "2026-07-15" });
  });

  it("falls back to subject and safe defaults when null", () => {
    expect(draftFromSuggestion(null, "Discount App report")).toEqual({
      task_name: "Discount App report", work_stream: "", sprint_points: 1, due_date: null,
    });
  });

  it("floors points to an integer >= 1 and rejects bad dates", () => {
    const d = draftFromSuggestion(
      { task_name: "", sprint_points: 0.4, due_date: "not-a-date" }, "Subj",
    );
    expect(d.sprint_points).toBe(1);
    expect(d.due_date).toBeNull();
    expect(d.task_name).toBe("Subj");
  });
});
