// One reading of "hours" for every step editor.
//
// process_steps_min_hours is a CHECK constraint, so an unguarded field turns a
// typo into a 400 whose toast reads `violates check constraint
// "process_steps_min_hours"`. Each editor used to carry its own copy of this
// rule — and the canvas inspector's copy was missing the floor entirely, which
// is how 0.15 reached Postgres.

/**
 * The DB's floor, in hours (0122). Zero is allowed: a step can be a check or a
 * hand-off that takes no measurable time. NULL still means "not estimated",
 * which is a different thing from "takes no time".
 */
export const MIN_STEP_HOURS = 0;

export type StepHours =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

/**
 * Reads a step's hours field. Blank clears the value; anything that isn't a
 * number at or above the minimum comes back as a message to show the person,
 * never as a request.
 */
export function parseStepHours(raw: string): StepHours {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return { ok: false, message: "Hours must be a number" };
  }
  if (parsed < MIN_STEP_HOURS) {
    return { ok: false, message: "Hours can't be negative — leave it blank if there's no estimate" };
  }
  return { ok: true, value: parsed };
}
