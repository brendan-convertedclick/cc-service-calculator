// supabase/functions/_shared/clickup.ts
//
// Canonical home for ClickUp helper functions. Imported by push-to-clickup
// (and any future edge function that posts BRIEF:: comments or resolves
// list aliases). The src/lib/clickup-shared.ts copy will be deleted in T11.

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
