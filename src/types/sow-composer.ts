// src/types/sow-composer.ts
//
// Types + zod schemas for the Scope Composer (visual SOW builder).
//
// An SOW document/template `body` is an ordered array of typed Section nodes.
// The variable registry is typed; variables resolve through a sparse override
// chain (document > client > record > registry default), presence-checked so a
// `0`/`false` override is honoured. All money is int cents (formatted en-ZA
// ZAR on the edge); hours are numeric. Nothing here imports React or Supabase
// so the resolvers built on top stay pure and golden-testable.

import { z } from "zod";
import type { Disposition } from "@/types/sow-placements";

// ── Variable registry ────────────────────────────────────────────────────────

export const variableTypeSchema = z.enum([
  "text",
  "number",
  "currency_cents",
  "percent",
  "date",
  "boolean",
  "enum",
  "computed",
]);
export type VariableType = z.infer<typeof variableTypeSchema>;

/** A registry row (sow_variables). `expression` is present iff type==='computed'. */
export const variableDefSchema = z.object({
  id: z.string(),
  // dotted namespace: client.name, pricing.hourly_rate, agency.vat_pct …
  key: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  label: z.string().nullable(),
  type: variableTypeSchema,
  scope: z.enum(["global", "template", "computed"]),
  template_id: z.string().nullable(),
  default_value: z.unknown().nullable(),
  expression: z.string().nullable(),
  enum_options: z.array(z.string()).nullable(),
});
export type VariableDef = z.infer<typeof variableDefSchema>;

/**
 * Sparse override layer — a plain map. The *presence* of a key (not its
 * truthiness) is the override test, so `{ "pricing.hourly_rate": 0 }` overrides
 * to zero instead of falling through to the default.
 */
export type OverrideMap = Record<string, unknown>;

/** Where a resolved value came from — surfaced in the merge-field chip tooltip. */
export type VarSource = "document" | "client" | "record" | "registry" | "computed";

/** One resolved variable in the bag. */
export interface ResolvedVar {
  key: string;
  type: VariableType;
  /** Raw resolved value — cents stay integer, percents stay numbers. */
  value: unknown;
  /** Display string (formatVar): en-ZA ZAR for currency_cents, "15%" for percent, … */
  formatted: string;
  source: VarSource;
}

/** The fully-resolved variable bag, keyed by dotted variable key. */
export type VariableBag = Record<string, ResolvedVar>;

// ── Section node model (sow_templates / sow_documents `body` jsonb) ───────────

export const sectionTypeSchema = z.enum([
  "prose",
  "service_table",
  "clause",
  "list",
  "signature",
]);
export type SectionType = z.infer<typeof sectionTypeSchema>;

const dispositionSchema: z.ZodType<Disposition> = z.enum([
  "in_agreed_scope",
  "new_billable",
  "out_of_scope",
]);

/**
 * A service_table line. Deliberately mirrors the ReceiptLine/placement shape so
 * the existing buildScopeReceipt() reducer runs over it unmodified.
 */
export const serviceTableLineSchema = z.object({
  taskRef: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  qty: z.number().positive(),
  unitCents: z.number().int().nonnegative(),
  disposition: dispositionSchema,
});
export type ServiceTableLine = z.infer<typeof serviceTableLineSchema>;

export const sectionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("prose"),
    ordinal: z.number().int(),
    props: z.object({ heading: z.string().optional(), markdown: z.string() }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("service_table"),
    ordinal: z.number().int(),
    props: z.object({
      heading: z.string().optional(),
      lines: z.array(serviceTableLineSchema),
      showCostColumn: z.boolean().default(true),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("clause"),
    ordinal: z.number().int(),
    props: z.object({ heading: z.string().optional(), clauseKey: z.string() }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("list"),
    ordinal: z.number().int(),
    props: z.object({
      heading: z.string().optional(),
      variant: z.enum(["inclusions", "exclusions"]),
      items: z.array(z.string()),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("signature"),
    ordinal: z.number().int(),
    props: z.object({ heading: z.string().optional() }),
  }),
]);
export type Section = z.infer<typeof sectionSchema>;

export const sowBodySchema = z.array(sectionSchema);
export type SowBody = z.infer<typeof sowBodySchema>;

// ── Row shapes (not in generated db.ts — queried untyped, cast in hooks) ──────

export interface SowTemplate {
  id: string;
  name: string;
  slug: string | null;
  kind: "template" | "snippet";
  master_sow_slug: string | null;
  body: SowBody;
  schema_version: number;
  archived_at: string | null;
}

export interface SowDocument {
  id: string;
  template_id: string | null;
  client_id: string | null;
  brief_id: string | null;
  quote_id: string | null;
  title: string;
  body: SowBody;
  variable_overrides: OverrideMap;
  status: "draft" | "final" | "sent";
  rendered_pdf_url: string | null;
  schema_version: number;
}

export interface SowLibraryItem {
  id: string;
  name: string;
  type: SectionType;
  node: Section;
  tags: string[];
}

// ── Scenarios (the "run test scenarios" feature) ──────────────────────────────

/**
 * A named variable-override set. Picking one re-resolves the bag live in the
 * editor; the SAME shape feeds the golden tests and the Playwright stubs, so
 * the product's what-if engine and the test harness share one resolver.
 */
export interface SowScenario {
  name: string;
  description?: string;
  /** Overlaid on top of the document overrides when this scenario is active. */
  overrides: OverrideMap;
}
