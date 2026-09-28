// src/lib/results-grid.ts
//
// Pure grid logic for the school year results planner (/results/:clientId).
// No React, no supabase — see docs/superpowers/specs/2026-09-28-school-year-results-design.md
// for the rules this encodes, and the mockup's script for the reference
// behaviour this was ported from (fmt/state/stars/lines in the mockup).

import { formatZar } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { todayISO } from "@/lib/dates";

export type FieldType = "number" | "money" | "percent" | "date" | "text";
export type FieldPhase = "plan" | "result";

export interface ResultsTemplateField {
  id: string;
  label: string;
  short_label: string | null;
  type: FieldType;
  phase: FieldPhase;
  star: boolean;
  target_field_id: string | null;
  ordinal: number;
  retired_at: string | null;
}

export interface ResultsTemplate {
  id: string;
  name: string;
  fields: ResultsTemplateField[];
}

/** fieldId -> value. Blank is represented as null/undefined/"" — never a key
 * that must be deleted to mean "no value". */
export type EntryValues = Record<string, number | string | null | undefined>;

export interface YearMonth {
  year: number;
  month: number;
}

export type CellState = "empty" | "plan" | "due" | "done";

const has = (v: number | string | null | undefined): boolean => v !== undefined && v !== null && v !== "";

/** Rule 7: results open from the start of the month, so "past" for the due/done
 * split means strictly before now's month — the current month is open, not due. */
export function resultsOpen(year: number, month: number, now: YearMonth): boolean {
  return year < now.year || (year === now.year && month <= now.month);
}

function isPast(year: number, month: number, now: YearMonth): boolean {
  return year < now.year || (year === now.year && month < now.month);
}

function liveFields(template: ResultsTemplate): ResultsTemplateField[] {
  return template.fields.filter((f) => !f.retired_at);
}

function hasResults(template: ResultsTemplate, values: EntryValues): boolean {
  return template.fields.some((f) => f.phase === "result" && has(values[f.id]));
}

/** empty (no entry) · plan (entry, no results yet, month not past) ·
 * due (entry, no results, month is over) · done (any result field has a value). */
export function cellState(
  year: number,
  month: number,
  template: ResultsTemplate,
  values: EntryValues | undefined,
  now: YearMonth,
): CellState {
  if (!values) return "empty";
  if (hasResults(template, values)) return "done";
  return isPast(year, month, now) ? "due" : "plan";
}

const dateFormatter = new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short" });

/** Formats a field's value for display. Dates are parsed from their
 * 'YYYY-MM-DD' parts directly — never via `new Date(str).toISOString()`,
 * which shifts a SAST date across midnight (see @/lib/dates). */
export function formatValue(field: Pick<ResultsTemplateField, "type">, value: number | string | null | undefined): string {
  if (!has(value)) return "";
  if (field.type === "money") return formatZar(Number(value));
  if (field.type === "number") return formatNumber(Number(value));
  if (field.type === "percent") return `${value}%`;
  if (field.type === "date") {
    const [y, m, d] = String(value).split("-").map(Number);
    return dateFormatter.format(new Date(y, m - 1, d));
  }
  return String(value);
}

/** Live result-phase starred fields, ordinal order, capped at two — the
 * DB trigger already refuses a third, this cap just guards against stale data. */
export function starredFields(template: ResultsTemplate): ResultsTemplateField[] {
  return liveFields(template)
    .filter((f) => f.star && f.phase === "result")
    .sort((a, b) => a.ordinal - b.ordinal)
    .slice(0, 2);
}

/** The first live plan field with a value, formatted — what a "plan" / "due" cell shows. */
export function planHeadline(template: ResultsTemplate, values: EntryValues): string {
  const field = liveFields(template)
    .filter((f) => f.phase === "plan")
    .sort((a, b) => a.ordinal - b.ordinal)
    .find((f) => has(values[f.id]));
  return field ? formatValue(field, values[field.id]) : "";
}

export interface CompareLine {
  value: string;
  target?: { value: string; met: boolean };
  lastYear?: { value: string; deltaPct?: number };
}

/** "How it compares" for one numeric/date-less result field: its formatted
 * value, target ("of N target") when the field names one and both have
 * values, and last year's value with a % change (omitted when last year is
 * blank or zero — a zero denominator makes a percentage meaningless). */
export function compareLine(
  field: ResultsTemplateField,
  now: EntryValues,
  target: EntryValues,
  lastYear: EntryValues,
): CompareLine | null {
  const nowValue = now[field.id];
  const wasValue = lastYear[field.id];
  if (!has(nowValue) && !has(wasValue)) return null;

  const line: CompareLine = { value: formatValue(field, nowValue) };

  if (field.target_field_id) {
    const targetValue = target[field.target_field_id];
    if (has(targetValue) && has(nowValue)) {
      line.target = { value: formatValue(field, targetValue), met: Number(nowValue) >= Number(targetValue) };
    }
  }

  if (has(wasValue)) {
    const lastYearLine: CompareLine["lastYear"] = { value: formatValue(field, wasValue) };
    const wasNum = Number(wasValue);
    if (has(nowValue) && wasNum !== 0) {
      lastYearLine.deltaPct = Math.round(((Number(nowValue) - wasNum) / wasNum) * 100);
    }
    line.lastYear = lastYearLine;
  }

  return line;
}

/** How far back a compared year is, clamped to the three grey bands. */
export function laneShade(year: number, compareYear: number): 1 | 2 | 3 {
  return Math.min(3, Math.max(1, Math.abs(year - compareYear))) as 1 | 2 | 3;
}

export const GROUP_COLOURS = ["violet", "teal", "amber", "rose", "blue", "green"] as const;
export type GroupColour = (typeof GROUP_COLOURS)[number];

export interface StandardRow {
  name: string;
  templateName?: string; // override of the group's template, resolved to an id at insert time
}

export interface StandardGroup {
  name: string;
  colour: GroupColour;
  templateName: string;
  rows: StandardRow[];
}

/** The five standard groups + rows from the mockup, seeded by
 * useSeedStandardGroups when a client has no groups yet (spec "Start from
 * the standard groups"). Template names resolve to ids at insert time. */
export const STANDARD_GROUPS: StandardGroup[] = [
  {
    name: "Paid media",
    colour: "blue",
    templateName: "Paid channel",
    rows: [{ name: "Google Search" }, { name: "PMax" }, { name: "Meta ads" }],
  },
  {
    name: "Social media",
    colour: "rose",
    templateName: "Social",
    rows: [{ name: "Instagram" }, { name: "Facebook" }, { name: "LinkedIn" }],
  },
  {
    name: "Content",
    colour: "green",
    templateName: "Guide",
    rows: [{ name: "Ultimate guides" }, { name: "Blog posts" }],
  },
  {
    name: "Events",
    colour: "violet",
    templateName: "Open day",
    rows: [
      { name: "Open Day · Term 1" },
      { name: "Open Day · Term 3" },
      { name: "Prize-giving", templateName: "Event" },
    ],
  },
  {
    name: "Campaigns",
    colour: "teal",
    templateName: "Campaign",
    rows: [{ name: "Grade 8 · 2028 intake" }],
  },
];

/** "Now", as {year, month} — the current calendar month, local time. */
export function nowYM(): YearMonth {
  const [y, m] = todayISO().split("-").map(Number);
  return { year: y, month: m };
}
