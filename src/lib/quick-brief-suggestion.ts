export type QuickTaskSuggestion = {
  task_name?: unknown; work_stream?: unknown;
  sprint_points?: unknown; due_date?: unknown; assignee_hint?: unknown;
};
export type QuickBriefDraft = {
  task_name: string; work_stream: string; sprint_points: number; due_date: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

export function draftFromSuggestion(
  suggestion: QuickTaskSuggestion | null,
  fallbackSubject: string,
): QuickBriefDraft {
  const s = suggestion ?? {};
  const pointsRaw = typeof s.sprint_points === "number" ? s.sprint_points : Number(s.sprint_points);
  const sprint_points = Number.isFinite(pointsRaw) ? Math.max(1, Math.round(pointsRaw)) : 1;
  const due =
    typeof s.due_date === "string" && ISO_DATE.test(s.due_date) && !Number.isNaN(Date.parse(s.due_date))
      ? s.due_date
      : null;
  return {
    task_name: str(s.task_name, fallbackSubject || "Untitled task"),
    work_stream: str(s.work_stream, ""),
    sprint_points,
    due_date: due,
  };
}
