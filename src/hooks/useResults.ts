// src/hooks/useResults.ts
//
// Data layer for the school year results planner (/results/:clientId) and
// its template editor (/results/templates). Pure grid maths lives in
// @/lib/results-grid — this file is only supabase reads/writes + TanStack
// Query wiring. See docs/superpowers/specs/2026-09-28-school-year-results-design.md.

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/utils";
import {
  hasValue,
  STANDARD_GROUPS,
  type EntryValues,
  type FieldPhase,
  type FieldType,
  type GroupColour,
  type LinkedTask,
  type ResultsTemplate,
  type ResultsTemplateField,
} from "@/lib/results-grid";

export const RESULTS_TEMPLATES_KEY = ["results-templates"] as const;
export const RESULTS_BOARD_KEY = (clientId: string) => ["results-board", clientId] as const;
const FIELD_VALUE_COUNTS_KEY = (templateId: string) => ["results-field-value-counts", templateId] as const;
export const TASK_LINKS_KEY = (yearId: string) => ["results-task-links", yearId] as const;

// ---------------------------------------------------------------------------
// Templates (master library, read on both the planner and the editor)
// ---------------------------------------------------------------------------

/** Every template with its fields, ordinal-ordered. The planner uses this to
 * resolve a group/row's template; the editor uses it as its list + form data. */
export function useResultTemplates() {
  return useQuery({
    queryKey: RESULTS_TEMPLATES_KEY,
    queryFn: async (): Promise<ResultsTemplate[]> => {
      const { data: templates, error: tplErr } = await supabase
        .from("results_templates")
        .select("id, name")
        .order("name");
      if (tplErr) throw new Error(errorMessage(tplErr));

      const { data: fields, error: fieldErr } = await supabase
        .from("results_template_fields")
        .select("id, template_id, label, short_label, type, phase, star, target_field_id, ordinal, retired_at")
        .order("ordinal");
      if (fieldErr) throw new Error(errorMessage(fieldErr));

      return (templates ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        fields: (fields ?? [])
          .filter((f) => f.template_id === t.id)
          .map(
            (f): ResultsTemplateField => ({
              id: f.id,
              label: f.label,
              short_label: f.short_label,
              type: f.type as FieldType,
              phase: f.phase as FieldPhase,
              star: f.star,
              target_field_id: f.target_field_id,
              ordinal: f.ordinal,
              retired_at: f.retired_at,
            }),
          ),
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Board (one client's groups/rows/entries)
// ---------------------------------------------------------------------------

export interface ResultsBoardRow {
  id: string;
  name: string;
  templateId: string | null; // null = use the group's template
  ordinal: number;
}

export interface ResultsBoardGroup {
  id: string;
  name: string;
  colour: GroupColour;
  /** 0192: a GROUP_ICONS key, or null for the default by name. */
  icon: string | null;
  /** 0194: acquisition / presence / account, or null for the default by name. */
  section: string | null;
  templateId: string;
  ordinal: number;
  rows: ResultsBoardRow[];
}

export interface ResultsBoardEntry {
  entryId: string;
  values: EntryValues;
  updatedBy: string | null;
  day: number | null;
}

export interface ResultsBoard {
  groups: ResultsBoardGroup[];
  /** keyed `${rowId}|${year}|${month}` */
  entries: Record<string, ResultsBoardEntry>;
  /** keyed `${rowId}|${year}|${month}` — pipeline tasks linked to this row for
   * that month (results_task_links via the results_linked_tasks view, 0180).
   * Several tasks may link to the same row/month; results stay one entry. */
  linkedTasks: Record<string, LinkedTask[]>;
}

/** Groups → rows → entries+values → linked pipeline tasks for the requested
 * years, in four round trips regardless of how many rows/years there are. A
 * field's value column (num/text/date) is fixed by its type at write time,
 * so reading is a plain coalesce — no need to re-look-up the field's type
 * here. */
export function useResultsBoard(clientId: string | undefined, years: number[]) {
  const sortedYears = [...years].sort((a, b) => a - b);
  return useQuery({
    queryKey: [...RESULTS_BOARD_KEY(clientId ?? ""), sortedYears],
    enabled: !!clientId && sortedYears.length > 0,
    queryFn: async (): Promise<ResultsBoard> => {
      const { data: groups, error: groupErr } = await supabase
        .from("results_groups")
        .select("id, name, colour, icon, section, template_id, ordinal")
        .eq("client_id", clientId!)
        .order("ordinal");
      if (groupErr) throw new Error(errorMessage(groupErr));

      const groupIds = (groups ?? []).map((g) => g.id);
      const { data: rows, error: rowErr } = groupIds.length
        ? await supabase
            .from("results_rows")
            .select("id, group_id, name, template_id, ordinal")
            .in("group_id", groupIds)
            .order("ordinal")
        : { data: [], error: null };
      if (rowErr) throw new Error(errorMessage(rowErr));

      const rowIds = (rows ?? []).map((r) => r.id);
      const { data: entries, error: entryErr } = rowIds.length
        ? await supabase
            .from("results_entries")
            .select("id, row_id, year, month, updated_by, day, values:results_entry_values(field_id, num_value, text_value, date_value)")
            .in("row_id", rowIds)
            .in("year", sortedYears)
        : { data: [], error: null };
      if (entryErr) throw new Error(errorMessage(entryErr));

      const { data: linked, error: linkedErr } = rowIds.length
        ? await supabase
            .from("results_linked_tasks")
            .select("task_id, row_id, year_id, label, side, state, done_at, year, month, day")
            .in("row_id", rowIds)
            .in("year", sortedYears)
        : { data: [], error: null };
      if (linkedErr) throw new Error(errorMessage(linkedErr));

      const entryMap: Record<string, ResultsBoardEntry> = {};
      for (const e of entries ?? []) {
        const values: EntryValues = {};
        for (const v of e.values ?? []) {
          values[v.field_id] = v.num_value ?? v.text_value ?? v.date_value ?? null;
        }
        entryMap[`${e.row_id}|${e.year}|${e.month}`] = { entryId: e.id, values, updatedBy: e.updated_by, day: e.day };
      }

      const linkedMap: Record<string, LinkedTask[]> = {};
      for (const l of linked ?? []) {
        if (l.row_id == null || l.year == null || l.month == null) continue; // view columns are nullable by shape
        const key = `${l.row_id}|${l.year}|${l.month}`;
        const task: LinkedTask = {
          taskId: l.task_id!,
          rowId: l.row_id,
          yearId: l.year_id!,
          label: l.label ?? "",
          side: l.side as "us" | "school",
          state: l.state as "planned" | "scheduled" | "done",
          doneAt: l.done_at,
          day: l.day,
        };
        (linkedMap[key] ??= []).push(task);
      }

      return {
        groups: (groups ?? []).map(
          (g): ResultsBoardGroup => ({
            id: g.id,
            name: g.name,
            colour: g.colour as GroupColour,
            icon: g.icon,
            section: g.section,
            templateId: g.template_id,
            ordinal: g.ordinal,
            rows: (rows ?? [])
              .filter((r) => r.group_id === g.id)
              .map((r) => ({ id: r.id, name: r.name, templateId: r.template_id, ordinal: r.ordinal })),
          }),
        ),
        entries: entryMap,
        linkedTasks: linkedMap,
      };
    },
  });
}

/** Returns the invalidation's promise (review finding 3) so every caller's
 * `onSuccess: (_d, vars) => invalidateBoard(qc, vars.clientId)` — an implicit
 * arrow return — hands that promise back to the mutation. React Query awaits
 * `onSuccess`'s return before settling the mutation, so `mutate`'s own
 * `onSuccess` (e.g. opening the panel, or a template re-seed) now runs after
 * the refetch lands rather than racing it on the still-stale cache. */
function invalidateBoard(qc: QueryClient, clientId: string) {
  return qc.invalidateQueries({ queryKey: RESULTS_BOARD_KEY(clientId) });
}

/** Same promise-returning shape as invalidateBoard, for the three mutations
 * that can change which rows the "Show in Year results" picker offers
 * (TaskResultsLink's useResultsPickerGroups) — a new group or row must show
 * up there without a reload. */
function invalidateBoardAndPicker(qc: QueryClient, clientId: string) {
  return Promise.all([invalidateBoard(qc, clientId), qc.invalidateQueries({ queryKey: ["results-picker-groups", clientId] })]);
}

// ---------------------------------------------------------------------------
// Saving a cell
// ---------------------------------------------------------------------------

/** Upserts one month's entry for a row, then its values. `vars.values` is a
 * changeset, not the entry's full state: only fields present as a key are
 * touched (a non-blank value upserted, `null`/blank deleted) — a field the
 * caller left out, live or retired, is left exactly as stored. Callers
 * therefore only pass fields whose draft actually changed (see EntryPanel),
 * so an untouched field is never blindly resent or deleted for being absent.
 * An entry left with nothing stored (every field cleared, or a save where
 * every field came back blank) is deleted rather than kept as an empty row —
 * an empty entry still reads as "planned" to `cellState`, so it would sit
 * forever. The one exception is `day` (month-view addendum rule 3): an entry
 * with only a day and no values is a real planned item and must survive the
 * same cleanup.
 *
 * `vars.day` is `undefined` to leave the stored day unchanged, `null` to
 * clear it, or a number to set it. */
export function useSaveEntry() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();
  return useMutation({
    mutationFn: async (vars: {
      clientId: string;
      rowId: string;
      year: number;
      month: number;
      template: ResultsTemplate;
      values: EntryValues;
      day?: number | null;
    }) => {
      const { data: existing, error: selErr } = await supabase
        .from("results_entries")
        .select("id, day")
        .eq("row_id", vars.rowId)
        .eq("year", vars.year)
        .eq("month", vars.month)
        .maybeSingle();
      if (selErr) throw new Error(errorMessage(selErr));

      const effectiveDay = vars.day !== undefined ? vars.day : (existing?.day ?? null);

      const fieldsToTouch = vars.template.fields.filter((f) => f.id in vars.values);
      const toDelete: string[] = [];
      const toUpsert: {
        entry_id: string;
        field_id: string;
        num_value: number | null;
        text_value: string | null;
        date_value: string | null;
      }[] = [];
      for (const field of fieldsToTouch) {
        const v = vars.values[field.id];
        if (!hasValue(v)) {
          toDelete.push(field.id);
          continue;
        }
        toUpsert.push({
          entry_id: "", // filled in once the entry row exists, below
          field_id: field.id,
          num_value: field.type === "number" || field.type === "money" || field.type === "percent" ? Number(v) : null,
          text_value: field.type === "text" ? String(v) : null,
          date_value: field.type === "date" ? String(v) : null,
        });
      }

      // Nothing to store, no day to plant, and no entry to clear — don't
      // create an empty row.
      if (!existing && toUpsert.length === 0 && effectiveDay == null) return;

      let entryId: string;
      if (existing) {
        entryId = existing.id;
        const update: { updated_by: string | null; day?: number | null } = { updated_by: currentUserId };
        if (vars.day !== undefined) update.day = vars.day;
        const { error } = await supabase.from("results_entries").update(update).eq("id", entryId);
        if (error) throw new Error(errorMessage(error));
      } else {
        const { data: created, error } = await supabase
          .from("results_entries")
          .insert({
            row_id: vars.rowId,
            year: vars.year,
            month: vars.month,
            created_by: currentUserId,
            updated_by: currentUserId,
            day: vars.day ?? null,
          })
          .select("id")
          .single();
        if (error) throw new Error(errorMessage(error));
        entryId = created.id;
      }
      for (const row of toUpsert) row.entry_id = entryId;

      if (toDelete.length) {
        const { error } = await supabase
          .from("results_entry_values")
          .delete()
          .eq("entry_id", entryId)
          .in("field_id", toDelete);
        if (error) throw new Error(errorMessage(error));
      }
      if (toUpsert.length) {
        const { error } = await supabase.from("results_entry_values").upsert(toUpsert, { onConflict: "entry_id,field_id" });
        if (error) throw new Error(errorMessage(error));
      }

      // If nothing survives on the entry (no values and no day — everything
      // just deleted, or a pre-existing entry that came in with no upserts),
      // drop the row too. A day-only entry is a real planned item (rule 3)
      // and must not be swept up here.
      if (effectiveDay == null) {
        const { count, error: cntErr } = await supabase
          .from("results_entry_values")
          .select("field_id", { count: "exact", head: true })
          .eq("entry_id", entryId);
        if (cntErr) throw new Error(errorMessage(cntErr));
        if (!count) {
          const { error } = await supabase.from("results_entries").delete().eq("id", entryId);
          if (error) throw new Error(errorMessage(error));
        }
      }
    },
    onSuccess: (_d, vars) => invalidateBoard(qc, vars.clientId),
  });
}

/** Month view's "+ Plan" → pick a row → Plan it: sets the row's day for that
 * month (creating the entry if none exists yet) and, if the template has a
 * live plan-phase date field, fills it with that date too — so a chip planted
 * via the calendar also shows up correctly if the plan phase's own date field
 * is later checked. Built from year/month/day parts, never via `Date`, so it
 * can't shift across a SAST midnight (CLAUDE.md). Thin wrapper over
 * useSaveEntry — same changeset semantics, same board invalidation. */
export function usePlanOnDay() {
  const save = useSaveEntry();
  return useMutation({
    mutationFn: async (vars: {
      clientId: string;
      rowId: string;
      year: number;
      month: number;
      day: number;
      template: ResultsTemplate;
      existingValues: EntryValues;
    }) => {
      const dateField = vars.template.fields
        .filter((f) => f.phase === "plan" && f.type === "date" && !f.retired_at)
        .sort((a, b) => a.ordinal - b.ordinal)[0];

      const values: EntryValues = {};
      if (dateField) {
        const dateStr = `${vars.year}-${String(vars.month).padStart(2, "0")}-${String(vars.day).padStart(2, "0")}`;
        if (vars.existingValues[dateField.id] !== dateStr) values[dateField.id] = dateStr;
      }

      await save.mutateAsync({
        clientId: vars.clientId,
        rowId: vars.rowId,
        year: vars.year,
        month: vars.month,
        template: vars.template,
        values,
        day: vars.day,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Groups / rows
// ---------------------------------------------------------------------------

export function useAddGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { clientId: string; name: string; colour: GroupColour; templateId: string }) => {
      const { count, error: countErr } = await supabase
        .from("results_groups")
        .select("id", { count: "exact", head: true })
        .eq("client_id", vars.clientId);
      if (countErr) throw new Error(errorMessage(countErr));

      const { error } = await supabase.from("results_groups").insert({
        client_id: vars.clientId,
        name: vars.name,
        colour: vars.colour,
        template_id: vars.templateId,
        ordinal: count ?? 0,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => invalidateBoardAndPicker(qc, vars.clientId),
  });
}

export function useAddRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { clientId: string; groupId: string; name: string; templateId?: string | null }) => {
      const { count, error: countErr } = await supabase
        .from("results_rows")
        .select("id", { count: "exact", head: true })
        .eq("group_id", vars.groupId);
      if (countErr) throw new Error(errorMessage(countErr));

      const { error } = await supabase.from("results_rows").insert({
        group_id: vars.groupId,
        name: vars.name,
        template_id: vars.templateId ?? null,
        ordinal: count ?? 0,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => invalidateBoardAndPicker(qc, vars.clientId),
  });
}

/** "Start from the standard groups": creates the five mockup groups (and
 * their rows) for a client with none yet, resolving STANDARD_GROUPS'
 * template names to ids first so a typo in the constant fails loudly. */
export function useSeedStandardGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
      // Defensive (review finding 5): the UI only offers this button when the
      // board query came back with zero groups, but that check and this
      // mutation run against two different reads — refuse rather than lay a
      // second standard set over one a concurrent call (or a stale button
      // click) already created.
      const { count: existingCount, error: existingErr } = await supabase
        .from("results_groups")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId);
      if (existingErr) throw new Error(errorMessage(existingErr));
      if (existingCount) throw new Error("This client already has results groups.");

      const names = [
        ...new Set(STANDARD_GROUPS.flatMap((g) => [g.templateName, ...g.rows.map((r) => r.templateName).filter(Boolean)])),
      ] as string[];
      const { data: templates, error: tplErr } = await supabase.from("results_templates").select("id, name").in("name", names);
      if (tplErr) throw new Error(errorMessage(tplErr));
      const idByName = new Map((templates ?? []).map((t) => [t.name, t.id]));
      for (const name of names) {
        if (!idByName.has(name)) throw new Error(`results template "${name}" not found — seed migration out of date`);
      }

      for (const [gi, group] of STANDARD_GROUPS.entries()) {
        const { data: created, error: groupErr } = await supabase
          .from("results_groups")
          .insert({
            client_id: clientId,
            name: group.name,
            colour: group.colour,
            template_id: idByName.get(group.templateName)!,
            ordinal: gi,
          })
          .select("id")
          .single();
        if (groupErr) throw new Error(errorMessage(groupErr));

        const { error: rowErr } = await supabase.from("results_rows").insert(
          group.rows.map((row, ri) => ({
            group_id: created.id,
            name: row.name,
            template_id: row.templateName ? (idByName.get(row.templateName) ?? null) : null,
            ordinal: ri,
          })),
        );
        if (rowErr) throw new Error(errorMessage(rowErr));
      }
    },
    onSuccess: (_d, clientId) => invalidateBoardAndPicker(qc, clientId),
  });
}

// ---------------------------------------------------------------------------
// Pipeline task links (0180) — the pipeline side of "tasks as plans"
// ---------------------------------------------------------------------------

export interface TaskLink {
  rowId: string;
  rowName: string;
  groupName: string;
}

/** task id -> the results row it's linked to (label, for the pipeline card's
 * "In Year results: <row name>"), scoped to one school year. One round trip
 * via the `!inner` join filter (see useStepProcedures.ts for the same
 * pattern) rather than fetching every task id first. */
export function useTaskLinks(yearId: string | undefined) {
  return useQuery({
    queryKey: TASK_LINKS_KEY(yearId ?? ""),
    enabled: !!yearId,
    queryFn: async (): Promise<Map<string, TaskLink>> => {
      const { data, error } = await supabase
        .from("results_task_links")
        .select("school_task_id, row_id, results_rows(name, results_groups(name)), school_tasks!inner(year_id)")
        .eq("school_tasks.year_id", yearId!);
      if (error) throw new Error(errorMessage(error));

      const map = new Map<string, TaskLink>();
      for (const r of data ?? []) {
        map.set(r.school_task_id, {
          rowId: r.row_id,
          rowName: r.results_rows?.name ?? "",
          groupName: r.results_rows?.results_groups?.name ?? "",
        });
      }
      return map;
    },
  });
}

/** A client's results rows grouped by group, no entries — the "Show in Year
 * results" picker's data. Lighter than useResultsBoard (which requires
 * years and fetches entries/links too). */
export interface ResultsPickerRow {
  id: string;
  name: string;
}
export interface ResultsPickerGroup {
  id: string;
  name: string;
  colour: GroupColour;
  icon: string | null;
  section: string | null;
  rows: ResultsPickerRow[];
}

export function useResultsPickerGroups(clientId: string | undefined) {
  return useQuery({
    queryKey: ["results-picker-groups", clientId ?? ""],
    enabled: !!clientId,
    queryFn: async (): Promise<ResultsPickerGroup[]> => {
      const { data: groups, error: groupErr } = await supabase
        .from("results_groups")
        .select("id, name, colour, icon, section, ordinal")
        .eq("client_id", clientId!)
        .order("ordinal");
      if (groupErr) throw new Error(errorMessage(groupErr));

      const groupIds = (groups ?? []).map((g) => g.id);
      const { data: rows, error: rowErr } = groupIds.length
        ? await supabase.from("results_rows").select("id, group_id, name, ordinal").in("group_id", groupIds).order("ordinal")
        : { data: [], error: null };
      if (rowErr) throw new Error(errorMessage(rowErr));

      return (groups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        colour: g.colour as GroupColour,
        icon: g.icon,
        section: g.section,
        rows: (rows ?? []).filter((r) => r.group_id === g.id).map((r) => ({ id: r.id, name: r.name })),
      }));
    },
  });
}

/** Links a task to a results row — upsert on the task id (a task links to at
 * most one row, so re-picking moves the link rather than erroring). */
export function useLinkTask() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();
  return useMutation({
    mutationFn: async (vars: { yearId: string; clientId: string; taskId: string; rowId: string }) => {
      const { error } = await supabase
        .from("results_task_links")
        .upsert(
          { school_task_id: vars.taskId, row_id: vars.rowId, created_by: currentUserId },
          { onConflict: "school_task_id" },
        );
      if (error) throw new Error(errorMessage(error));
    },
    // Both invalidations are awaited (Promise.all, not a fire-and-forget
    // first call) so the mutation's own promise — and therefore a caller's
    // `mutate(vars, { onSuccess })` — only resolves once useTaskLinks has
    // actually refetched. TaskResultsLink's post-link/unlink focus move
    // depends on that: it must not fire before the new `link` prop lands.
    onSuccess: (_d, vars) =>
      Promise.all([qc.invalidateQueries({ queryKey: TASK_LINKS_KEY(vars.yearId) }), invalidateBoard(qc, vars.clientId)]),
  });
}

export function useUnlinkTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { yearId: string; clientId: string; taskId: string }) => {
      const { error } = await supabase.from("results_task_links").delete().eq("school_task_id", vars.taskId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) =>
      Promise.all([qc.invalidateQueries({ queryKey: TASK_LINKS_KEY(vars.yearId) }), invalidateBoard(qc, vars.clientId)]),
  });
}

// ---------------------------------------------------------------------------
// Template editor
// ---------------------------------------------------------------------------

export interface EditableField {
  id?: string; // undefined = a new field, not yet in the DB
  label: string;
  short_label: string | null;
  type: FieldType;
  phase: FieldPhase;
  star: boolean;
  target_field_id: string | null;
  retired_at: string | null;
}

/** Saves a template's name + its full edited field list: existing fields are
 * updated in place (ordinal = position in the list), new ones inserted.
 * Un-stars are written before stars so the DB's max-two-stars trigger never
 * sees a transient third star mid-save (rule 5).
 *
 * Returns the new rows' ids keyed by their index in `vars.fields` — a freshly
 * inserted field has no id in the caller's draft, and without patching one in
 * a second save re-inserts it (duplicates, and can trip the max-two-stars
 * trigger mid-save on a field that was never meant to be a third row). */
export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { templateId: string; name: string; fields: EditableField[] }): Promise<Record<number, string>> => {
      const { error: nameErr } = await supabase
        .from("results_templates")
        .update({ name: vars.name })
        .eq("id", vars.templateId);
      if (nameErr) throw new Error(errorMessage(nameErr));

      const existing = vars.fields.filter((f): f is EditableField & { id: string } => !!f.id);
      const created = vars.fields.filter((f) => !f.id);

      for (const batch of [existing.filter((f) => !f.star), existing.filter((f) => f.star)]) {
        for (const f of batch) {
          const { error } = await supabase
            .from("results_template_fields")
            .update({
              label: f.label,
              short_label: f.short_label,
              type: f.type,
              target_field_id: f.target_field_id,
              star: f.star,
              retired_at: f.retired_at,
              ordinal: vars.fields.indexOf(f),
            })
            .eq("id", f.id);
          if (error) throw new Error(errorMessage(error));
        }
      }

      const insertedIds: Record<number, string> = {};
      for (const f of created) {
        const { data, error } = await supabase
          .from("results_template_fields")
          .insert({
            template_id: vars.templateId,
            label: f.label,
            short_label: f.short_label,
            type: f.type,
            phase: f.phase,
            star: f.star,
            target_field_id: f.target_field_id,
            ordinal: vars.fields.indexOf(f),
          })
          .select("id")
          .single();
        if (error) throw new Error(errorMessage(error));
        insertedIds[vars.fields.indexOf(f)] = data.id;
      }
      return insertedIds;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: RESULTS_TEMPLATES_KEY });
      qc.invalidateQueries({ queryKey: FIELD_VALUE_COUNTS_KEY(vars.templateId) });
    },
  });
}

export function useAddTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<string> => {
      const { data, error } = await supabase.from("results_templates").insert({ name }).select("id").single();
      if (error) throw new Error(errorMessage(error));
      return data.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: RESULTS_TEMPLATES_KEY }),
  });
}

// ---------------------------------------------------------------------------
// Index (/results) — which clients have a results board to open
// ---------------------------------------------------------------------------

export interface ResultsClient {
  id: string;
  name: string;
}

/** Clients with a school year or any results_groups, for /results — the two
 * are separate tables (a school can have a pipeline year but no results yet,
 * or results without an active pipeline year), so this is a union of both,
 * deduped and name-sorted. */
export function useResultsClients() {
  return useQuery({
    queryKey: ["results-clients"],
    queryFn: async (): Promise<ResultsClient[]> => {
      const [yearsRes, groupsRes] = await Promise.all([
        supabase.from("school_years").select("client_id"),
        supabase.from("results_groups").select("client_id"),
      ]);
      if (yearsRes.error) throw new Error(errorMessage(yearsRes.error));
      if (groupsRes.error) throw new Error(errorMessage(groupsRes.error));

      const clientIds = [
        ...new Set([...(yearsRes.data ?? []), ...(groupsRes.data ?? [])].map((r) => r.client_id as string)),
      ];
      if (!clientIds.length) return [];

      const { data: clients, error } = await supabase.from("clients").select("id, name").in("id", clientIds).order("name");
      if (error) throw new Error(errorMessage(error));
      return clients ?? [];
    },
  });
}

/** Which of a template's fields have any recorded value, for the editor's
 * type-lock UI (rule 4 — a type can't change once data exists). */
export function useFieldValueCounts(templateId: string | undefined) {
  return useQuery({
    queryKey: FIELD_VALUE_COUNTS_KEY(templateId ?? ""),
    enabled: !!templateId,
    queryFn: async (): Promise<Set<string>> => {
      const { data: fields, error: fieldErr } = await supabase
        .from("results_template_fields")
        .select("id")
        .eq("template_id", templateId!);
      if (fieldErr) throw new Error(errorMessage(fieldErr));
      const fieldIds = (fields ?? []).map((f) => f.id);
      if (!fieldIds.length) return new Set();

      const { data: values, error: valueErr } = await supabase
        .from("results_entry_values")
        .select("field_id")
        .in("field_id", fieldIds);
      if (valueErr) throw new Error(errorMessage(valueErr));
      return new Set((values ?? []).map((v) => v.field_id));
    },
  });
}

/** Planner-only groups' icon and colour (0192), keyed by group name. */
export interface GroupStyle {
  icon: string | null;
  colour: GroupColour | null;
  section: string | null;
}

const GROUP_STYLES_KEY = (clientId: string) => ["pipeline-group-styles", clientId] as const;

export function useGroupStyles(clientId: string | undefined) {
  return useQuery({
    queryKey: GROUP_STYLES_KEY(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async (): Promise<Map<string, GroupStyle>> => {
      const { data, error } = await supabase.from("pipeline_group_styles").select("name, icon, colour, section").eq("client_id", clientId!);
      if (error) throw new Error(errorMessage(error));
      return new Map((data ?? []).map((r) => [r.name, { icon: r.icon, colour: r.colour as GroupColour | null, section: r.section }]));
    },
  });
}

/** Sets a group's icon or colour. A results group stores it on its own row,
 *  so Year results and the planner agree; a planner-only group has no row
 *  and stores it in pipeline_group_styles by name. */
export function useSetGroupStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      clientId: string;
      resultsGroupId: string | null;
      name: string;
      patch: { icon?: string; colour?: GroupColour; section?: string };
    }) => {
      if (vars.resultsGroupId) {
        const { error } = await supabase.from("results_groups").update(vars.patch).eq("id", vars.resultsGroupId);
        if (error) throw new Error(errorMessage(error));
        return;
      }
      const current = qc.getQueryData<Map<string, GroupStyle>>(GROUP_STYLES_KEY(vars.clientId))?.get(vars.name);
      const { error } = await supabase.from("pipeline_group_styles").upsert(
        {
          client_id: vars.clientId,
          name: vars.name,
          icon: vars.patch.icon ?? current?.icon ?? null,
          colour: vars.patch.colour ?? current?.colour ?? null,
          section: vars.patch.section ?? current?.section ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,name" },
      );
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: GROUP_STYLES_KEY(vars.clientId) });
      qc.invalidateQueries({ queryKey: ["results-picker-groups", vars.clientId] });
      qc.invalidateQueries({ queryKey: RESULTS_BOARD_KEY(vars.clientId) });
    },
  });
}
