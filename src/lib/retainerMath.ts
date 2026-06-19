// Preview of how a recurring-service row materialises into ClickUp tasks.
//
// Occurrences are PER ASSIGNEE, so total tasks = occurrences × assignees.
// A live-eligible row becomes ONE perpetual task per assignee (occurrences are
// ignored — time accrues continuously). 1 sprint point = 15 minutes.
export function retainerRowPreview(
  occurrencesPerMonth: number,
  pointsPerOccurrence: number,
  assigneeCount: number,
  isLive: boolean,
): string {
  const a = Math.max(0, Math.floor(assigneeCount));
  if (a === 0) return "→ add an assignee to see the task/hour total";
  const perAssignee = isLive ? 1 : Math.max(0, occurrencesPerMonth);
  const tasks = perAssignee * a;
  const hours = tasks * Math.max(0, pointsPerOccurrence) * 0.25;
  const each = a > 1 ? ` · ${(hours / a).toFixed(2)}h each` : "";
  const live = isLive ? "live " : "";
  return `→ ${tasks} ${live}task${tasks === 1 ? "" : "s"}/mo · ${hours.toFixed(2)}h total${each}`;
}
