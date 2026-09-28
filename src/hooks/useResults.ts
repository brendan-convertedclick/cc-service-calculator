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
  STANDARD_GROUPS,
  type EntryValues,
  type FieldPhase,
  type FieldType,
  type GroupColour,
  type ResultsTemplate,
  type ResultsTemplateField,
} from "@/lib/results-grid";

const has = (v: number | string | null | undefined): boolean => v !== undefined && v !== null && v !== "";

export const RESULTS_TEMPLATES_KEY = ["results-templates"] as const;
export const RESULTS_BOARD_KEY = (clientId: string) => ["results-board", clientId] as const;
const FIELD_VALUE_COUNTS_KEY = (templateId: string) => ["results-field-value-counts", templateId] as const;

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
  templateId: string;
  ordinal: number;
  rows: ResultsBoardRow[];
}

export interface ResultsBoardEntry {
  entryId: string;
  values: EntryValues;
  updatedBy: string | null;
}

export interface ResultsBoard {
  groups: ResultsBoardGroup[];
  /** keyed `${rowId}|${year}|${month}` */
  entries: Record<string, ResultsBoardEntry>;
}

/** Groups → rows → entries+values for the requested years, in three round
 * trips regardless of how many rows/years there are. A field's value column
 * (num/text/date) is fixed by its type at write time, so reading is a plain
 * coalesce — no need to re-look-up the field's type here. */
export function useResultsBoard(clientId: string | undefined, years: number[]) {
  const sortedYears = [...years].sort((a, b) => a - b);
  return useQuery({
    queryKey: [...RESULTS_BOARD_KEY(clientId ?? ""), sortedYears],
    enabled: !!clientId && sortedYears.length > 0,
    queryFn: async (): Promise<ResultsBoard> => {
      const { data: groups, error: groupErr } = await supabase
        .from("results_groups")
        .select("id, name, colour, template_id, ordinal")
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
            .select("id, row_id, year, month, updated_by, values:results_entry_values(field_id, num_value, text_value, date_value)")
            .in("row_id", rowIds)
            .in("year", sortedYears)
        : { data: [], error: null };
      if (entryErr) throw new Error(errorMessage(entryErr));

      const entryMap: Record<string, ResultsBoardEntry> = {};
      for (const e of entries ?? []) {
        const values: EntryValues = {};
        for (const v of e.values ?? []) {
          values[v.field_id] = v.num_value ?? v.text_value ?? v.date_value ?? null;
        }
        entryMap[`${e.row_id}|${e.year}|${e.month}`] = { entryId: e.id, values, updatedBy: e.updated_by };
      }

      return {
        groups: (groups ?? []).map(
          (g): ResultsBoardGroup => ({
            id: g.id,
            name: g.name,
            colour: g.colour as GroupColour,
            templateId: g.template_id,
            ordinal: g.ordinal,
            rows: (rows ?? [])
              .filter((r) => r.group_id === g.id)
              .map((r) => ({ id: r.id, name: r.name, templateId: r.template_id, ordinal: r.ordinal })),
          }),
        ),
        entries: entryMap,
      };
    },
  });
}

function invalidateBoard(qc: QueryClient, clientId: string) {
  qc.invalidateQueries({ queryKey: RESULTS_BOARD_KEY(clientId) });
}

// ---------------------------------------------------------------------------
// Saving a cell
// ---------------------------------------------------------------------------

/** Upserts one month's entry for a row, then its values: a non-blank live
 * field's value lands in the column its type owns (num/text/date), a
 * now-blank one is deleted. Only touches fields that are live or that the
 * caller explicitly passed a value for — a retired field nobody edited is
 * left alone. */
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
    }) => {
      const { data: existing, error: selErr } = await supabase
        .from("results_entries")
        .select("id")
        .eq("row_id", vars.rowId)
        .eq("year", vars.year)
        .eq("month", vars.month)
        .maybeSingle();
      if (selErr) throw new Error(errorMessage(selErr));

      let entryId: string;
      if (existing) {
        const { error } = await supabase
          .from("results_entries")
          .update({ updated_by: currentUserId })
          .eq("id", existing.id);
        if (error) throw new Error(errorMessage(error));
        entryId = existing.id;
      } else {
        const { data: created, error } = await supabase
          .from("results_entries")
          .insert({
            row_id: vars.rowId,
            year: vars.year,
            month: vars.month,
            created_by: currentUserId,
            updated_by: currentUserId,
          })
          .select("id")
          .single();
        if (error) throw new Error(errorMessage(error));
        entryId = created.id;
      }

      const fieldsToTouch = vars.template.fields.filter((f) => !f.retired_at || f.id in vars.values);
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
        if (!has(v)) {
          toDelete.push(field.id);
          continue;
        }
        toUpsert.push({
          entry_id: entryId,
          field_id: field.id,
          num_value: field.type === "number" || field.type === "money" || field.type === "percent" ? Number(v) : null,
          text_value: field.type === "text" ? String(v) : null,
          date_value: field.type === "date" ? String(v) : null,
        });
      }

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
    },
    onSuccess: (_d, vars) => invalidateBoard(qc, vars.clientId),
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
    onSuccess: (_d, vars) => invalidateBoard(qc, vars.clientId),
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
    onSuccess: (_d, vars) => invalidateBoard(qc, vars.clientId),
  });
}

/** "Start from the standard groups": creates the five mockup groups (and
 * their rows) for a client with none yet, resolving STANDARD_GROUPS'
 * template names to ids first so a typo in the constant fails loudly. */
export function useSeedStandardGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
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
    onSuccess: (_d, clientId) => invalidateBoard(qc, clientId),
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
 * sees a transient third star mid-save (rule 5). */
export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { templateId: string; name: string; fields: EditableField[] }) => {
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

      for (const f of created) {
        const { error } = await supabase.from("results_template_fields").insert({
          template_id: vars.templateId,
          label: f.label,
          short_label: f.short_label,
          type: f.type,
          phase: f.phase,
          star: f.star,
          target_field_id: f.target_field_id,
          ordinal: vars.fields.indexOf(f),
        });
        if (error) throw new Error(errorMessage(error));
      }
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
