// How a recurring-service row materialises into ClickUp tasks.
//
// Occurrences are PER ASSIGNEE, so total tasks = occurrences × assignees.
// A live-eligible row becomes ONE perpetual task per assignee (occurrences are
// ignored — time accrues continuously). 1 sprint point = 15 minutes.
export function retainerRowStats(
  occurrencesPerMonth: number,
  pointsPerOccurrence: number,
  assigneeCount: number,
  isLive: boolean,
): { tasks: number; points: number; hours: number } {
  const a = Math.max(0, Math.floor(assigneeCount));
  const perAssignee = isLive ? 1 : Math.max(0, occurrencesPerMonth);
  const tasks = perAssignee * a;
  const points = tasks * Math.max(0, pointsPerOccurrence);
  const hours = points * 0.25;
  return { tasks, points, hours };
}

export function retainerRowPreview(
  occurrencesPerMonth: number,
  pointsPerOccurrence: number,
  assigneeCount: number,
  isLive: boolean,
): string {
  const a = Math.max(0, Math.floor(assigneeCount));
  if (a === 0) return "→ add an assignee to see the task/hour total";
  const { tasks, hours } = retainerRowStats(occurrencesPerMonth, pointsPerOccurrence, a, isLive);
  const each = a > 1 ? ` · ${(hours / a).toFixed(2)}h each` : "";
  const live = isLive ? "live " : "";
  return `→ ${tasks} ${live}task${tasks === 1 ? "" : "s"}/mo · ${hours.toFixed(2)}h total${each}`;
}
