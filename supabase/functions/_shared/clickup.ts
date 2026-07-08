// supabase/functions/_shared/clickup.ts
//
// Canonical home for ClickUp helper functions. Imported by push-to-clickup
// (and any future edge function that posts BRIEF:: comments or resolves
// list aliases). Replaces the old src/lib/clickup-shared.ts (deleted in T11).

export type AliasRow = { work_stream: string; aliases: string[] };
export type OverrideRow = { client_id: string; work_stream: string; list_name: string };

export type AliasResolution = { list_name: string; source: "default" | "override" } | null;

export function resolveListAlias(
  input: string,
  aliases: AliasRow[],
  overrides: OverrideRow[],
  client_id?: string,
): AliasResolution {
  const needle = input.trim().toLowerCase();

  // Find the canonical work_stream by searching aliases (case-insensitive).
  const canonical = aliases.find(
    (a) =>
      a.work_stream.toLowerCase() === needle ||
      a.aliases.some((x) => x.toLowerCase() === needle),
  );
  if (!canonical) return null;

  if (client_id) {
    const o = overrides.find(
      (x) =>
        x.client_id === client_id &&
        x.work_stream.toLowerCase() === canonical.work_stream.toLowerCase(),
    );
    if (o) return { list_name: o.list_name, source: "override" };
  }
  return { list_name: canonical.work_stream, source: "default" };
}

export type BriefCommentPayload = {
  client_name: string;
  engagement_type: "Project" | "Task";
  work_stream: string;
  sprint_points: number;
  date_of_engagement: string; // ISO date
  source_quote_id: string;
};

/**
 * Match the grammar emitted by ~/.claude/skills/brief. Phase 3 will swap to
 * an envelope consumed by /brief instead of duplicating here.
 */
export function buildBriefComment(p: BriefCommentPayload): string {
  return `BRIEF:: ${JSON.stringify(p)}`;
}

/**
 * Find a ClickUp custom field definition by name (case-insensitive).
 * Returns the field id + type, or null. Caller decides how to format the
 * value for `POST /task/{id}/field/{field_id}` based on the type.
 *
 * Handles the same cuFields shape that push-to-clickup loads via
 * `GET /list/{id}/field`.
 */
export function findCustomField(
  cuFields: Array<{ id: string; name: string; type: string }>,
  name: string,
  expectedType?: string,
): { id: string; type: string } | null {
  const needle = name.trim().toLowerCase();
  const field = cuFields.find((f) => f.name.trim().toLowerCase() === needle);
  if (!field) return null;
  if (expectedType && field.type !== expectedType) return null;
  return { id: field.id, type: field.type };
}

const POINT_TO_MIN = 15;

export type BriefTaskInput = {
  listId: string;
  name: string;
  description: string;
  clientName: string;
  workStream: string;
  engagementType: string;
  sprintPoints: number;
  dateOfEngagement: string;
  assigneeClickupId?: number | null;
  dueDateMs?: number | null;
};

/**
 * Build the ClickUp task-create body for a single brief task: name,
 * description, time_estimate, custom_fields, and optional assignees/
 * due_date. Deliberately omits `status` — list-specific status sets make
 * hardcoding a value fail with CRTSK_001; let ClickUp use the list default.
 * Pure (no fetch) so it's unit-testable; the caller does the actual POST.
 */
export function buildBriefTaskBody(
  cuFields: Array<{ id: string; name: string; type: string }>,
  input: BriefTaskInput,
): Record<string, unknown> {
  const cf: Array<{ id: string; value: unknown }> = [];
  const client = findCustomField(cuFields, "Client Name");
  if (client) cf.push({ id: client.id, value: input.clientName });
  const doe = findCustomField(cuFields, "Date of Engagement");
  if (doe) {
    cf.push({
      id: doe.id,
      value: Date.UTC(
        Number(input.dateOfEngagement.slice(0, 4)),
        Number(input.dateOfEngagement.slice(5, 7)) - 1,
        Number(input.dateOfEngagement.slice(8, 10)),
      ),
    });
  }
  const et = findCustomField(cuFields, "Engagement Type");
  if (et) cf.push({ id: et.id, value: input.engagementType });
  const ws = findCustomField(cuFields, "Work Stream");
  if (ws) cf.push({ id: ws.id, value: input.workStream });
  const pts = findCustomField(cuFields, "Sprint Points");
  if (pts) cf.push({ id: pts.id, value: input.sprintPoints });

  const body: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    time_estimate: Math.round(input.sprintPoints * POINT_TO_MIN * 60_000),
    custom_fields: cf,
  };
  if (input.assigneeClickupId) body.assignees = [input.assigneeClickupId];
  if (input.dueDateMs) {
    body.due_date = input.dueDateMs;
    body.due_date_time = false;
  }
  return body;
}

export type CuField = {
  id: string;
  name: string;
  type: string;
  type_config?: { options?: Array<{ id: string; name?: string }> };
};

/**
 * Resolve a ClickUp DROPDOWN custom field + option by name (both
 * case-insensitive). Returns the `{id, value}` shape that a task-create
 * `custom_fields` array expects (value = the option's id), or null if the
 * field or the option isn't found — so callers can omit it gracefully.
 *
 * Mirrors the inline helper used in push-to-clickup / create-recurring-tasks.
 */
export function resolveDropdownOption(
  cuFields: CuField[],
  fieldName: string,
  optionName: string,
): { id: string; value: string } | null {
  const field = cuFields.find(
    (f) => f.name?.trim().toLowerCase() === fieldName.trim().toLowerCase() &&
      f.type === "drop_down",
  );
  if (!field?.type_config?.options) return null;
  const needle = optionName.trim().toLowerCase();
  const option = field.type_config.options.find(
    (o) => o.name?.trim().toLowerCase() === needle,
  );
  return option ? { id: field.id, value: option.id } : null;
}
