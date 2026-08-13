// Delivery order for the department tasks of one service.
//
// A service that spans departments (Content → Creative → Development) pushes
// one ClickUp child task per department. Their order can't come from
// departments.display_order — that's the catalogue/pricing order, where
// Development (10) sorts ahead of Content & Copywriting (60), which is the
// reverse of how a page is actually built. The service's own procedure knows
// the real sequence: whichever department owns the earliest step goes first.

export type DeptChild = { deptId: string; deptName: string; taskId: string };
export type SequenceStep = { department_id: string | null; ordinal: number };

/**
 * Orders a service's department children by the first step each department
 * owns. A child whose department never appears in the steps is dropped: with
 * no signal, a guessed position would produce a wrong "blocked by" link, which
 * is worse than no link at all. Stable within a department, so a service that
 * appears on two quote lines keeps its duplicates adjacent.
 */
export function orderChildrenBySteps(
  children: DeptChild[],
  steps: SequenceStep[],
): DeptChild[] {
  const firstOrdinal = new Map<string, number>();
  for (const s of steps) {
    if (!s.department_id) continue;
    const seen = firstOrdinal.get(s.department_id);
    if (seen === undefined || s.ordinal < seen) firstOrdinal.set(s.department_id, s.ordinal);
  }
  return children
    .filter((c) => firstOrdinal.has(c.deptId))
    .sort((a, b) => (firstOrdinal.get(a.deptId) ?? 0) - (firstOrdinal.get(b.deptId) ?? 0));
}
