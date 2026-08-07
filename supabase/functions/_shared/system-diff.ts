// supabase/functions/_shared/system-diff.ts
//
// Pure ordered-step-list diff for Phase 5 (system revisions). Compares two
// step snapshots by `id` and classifies each as added / removed / changed.
// No dependency (see spec C6 — jsondiffpatch was considered and dropped;
// this is ~30 lines of hand-rolled comparison over five named fields).
// Graph-topology diffing (edges, ordinal reshuffles) is explicitly out of
// scope — this is a step-existence-and-field diff only.

export type DiffStep = {
  id: string;
  title: string;
  estimated_hours: number | null;
  department_id: string | null;
  owner_id: string | null;
  materialise_as: "task" | "checklist_item" | "none";
};

export type DiffSummary = {
  added: DiffStep[];
  removed: DiffStep[];
  changed: Array<{ id: string; title: string; fields: Array<{ field: string; from: unknown; to: unknown }> }>;
};

// process_steps.estimated_hours is numeric(6,2); depending on the query path
// it can arrive as a JS number or as the string Postgres serialises numerics
// to (e.g. "4.00"). Normalise both null and undefined to null, and coerce
// numeric-looking values so 4 and "4.00" compare equal.
function normaliseHours(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

function normalise(v: unknown): unknown {
  return v === undefined ? null : v;
}

const CHANGED_FIELDS = ["title", "estimated_hours", "department_id", "owner_id", "materialise_as"] as const;

function fieldValue(step: DiffStep, field: (typeof CHANGED_FIELDS)[number]): unknown {
  if (field === "estimated_hours") return normaliseHours(step.estimated_hours);
  return normalise(step[field]);
}

export function diffSteps(before: DiffStep[], after: DiffStep[]): DiffSummary {
  const beforeById = new Map(before.map((s) => [s.id, s]));
  const afterById = new Map(after.map((s) => [s.id, s]));

  const added: DiffStep[] = [];
  const removed: DiffStep[] = [];
  const changed: DiffSummary["changed"] = [];

  for (const step of after) {
    if (!beforeById.has(step.id)) added.push(step);
  }
  for (const step of before) {
    if (!afterById.has(step.id)) removed.push(step);
  }
  for (const afterStep of after) {
    const beforeStep = beforeById.get(afterStep.id);
    if (!beforeStep) continue; // handled as added above

    const fields: DiffSummary["changed"][number]["fields"] = [];
    for (const field of CHANGED_FIELDS) {
      const from = fieldValue(beforeStep, field);
      const to = fieldValue(afterStep, field);
      if (from !== to) fields.push({ field, from, to });
    }
    if (fields.length > 0) {
      changed.push({ id: afterStep.id, title: afterStep.title, fields });
    }
  }

  return { added, removed, changed };
}
