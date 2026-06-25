// src/test/fixtures/sow/index.ts
//
// Named Scope Composer fixtures — the SINGLE source of truth shared by the
// pure-resolver unit tests, the component snapshot test, and the Playwright
// route stubs. Plain data only (no test-framework imports) so node e2e and
// vitest can both import it.

import type {
  OverrideMap,
  Section,
  ServiceTableLine,
  SowBody,
  SowDocument,
  SowScenario,
  VariableDef,
} from "@/types/sow-composer";

function vdef(
  over: Partial<VariableDef> & { key: string; type: VariableDef["type"] },
): VariableDef {
  return {
    id: over.key,
    label: over.label ?? over.key,
    scope: over.type === "computed" ? "computed" : "global",
    template_id: null,
    default_value: null,
    expression: null,
    enum_options: null,
    ...over,
  };
}

/** Mirrors the global variables seeded by migration 0072. */
export const REGISTRY: VariableDef[] = [
  vdef({ key: "client.name", type: "text", default_value: "Default Client" }),
  vdef({ key: "document.date", type: "date", default_value: null }),
  vdef({ key: "agency.vat_pct", type: "percent", default_value: 15 }),
  vdef({ key: "pricing.hourly_rate", type: "currency_cents", default_value: 150000 }),
  vdef({
    key: "pricing.total_incl_vat_cents",
    type: "computed",
    expression: "pricing.subtotal_cents * (1 + agency.vat_pct / 100)",
  }),
];

function line(over: Partial<ServiceTableLine> & { taskRef: string }): ServiceTableLine {
  return {
    name: over.taskRef,
    qty: 1,
    unitCents: 0,
    disposition: "new_billable",
    ...over,
  };
}

function proseSection(id: string, ordinal: number, markdown: string, heading?: string): Section {
  return { id, type: "prose", ordinal, props: { markdown, heading } };
}

function serviceTableSection(id: string, ordinal: number, lines: ServiceTableLine[]): Section {
  return { id, type: "service_table", ordinal, props: { lines, showCostColumn: true } };
}

// ── Bodies ────────────────────────────────────────────────────────────────────

export const EMPTY_BODY: SowBody = [];

/** Two billable lines → 100000 + 100000 = 200000 cents billable subtotal. */
export const SINGLE_SERVICE_TABLE_BODY: SowBody = [
  proseSection("intro", 0, "Scope of work for **{{client.name}}**.", "Overview"),
  serviceTableSection("svc-1", 1, [
    line({ taskRef: "a", name: "Landing page", qty: 2, unitCents: 50000, disposition: "new_billable" }),
    line({ taskRef: "b", name: "Email automation", qty: 1, unitCents: 100000, disposition: "new_billable" }),
    line({ taskRef: "c", name: "Monthly retainer hours", qty: 1, unitCents: 80000, disposition: "in_agreed_scope" }),
    line({ taskRef: "d", name: "TV advert", qty: 1, unitCents: 500000, disposition: "out_of_scope" }),
  ]),
];

/** Fractional qty to exercise cents rounding: 1.5 * 33333 = 49999.5 → 50000. */
export const MULTI_LINE_BODY: SowBody = [
  serviceTableSection("svc-multi", 0, [
    line({ taskRef: "x", name: "Design hours", qty: 1.5, unitCents: 33333, disposition: "new_billable" }),
    line({ taskRef: "y", name: "Dev hours", qty: 3, unitCents: 40000, disposition: "new_billable" }),
  ]),
];

export const UNKNOWN_VARIABLE_BODY: SowBody = [
  proseSection("intro", 0, "Prepared for {{client.name}} — ref {{client.unknown_field}}.", "Overview"),
];

// ── Fixtures (resolver inputs + expected outputs) ─────────────────────────────

export interface SowFixture {
  name: string;
  doc: SowDocument;
  registry: VariableDef[];
  recordValues?: OverrideMap;
  clientOverrides?: OverrideMap;
  scenarios?: SowScenario[];
  expectedBillableCents: number;
  /** pricing.total_incl_vat_cents with the document's own overrides applied. */
  expectedTotalInclVatCents: number;
}

function doc(over: Partial<SowDocument> & { id: string; body: SowBody }): SowDocument {
  return {
    template_id: null,
    client_id: "client-1",
    brief_id: null,
    quote_id: null,
    title: "Test SOW",
    variable_overrides: {},
    status: "draft",
    rendered_pdf_url: null,
    schema_version: 1,
    ...over,
  };
}

export const EMPTY_TEMPLATE: SowFixture = {
  name: "EMPTY_TEMPLATE",
  doc: doc({ id: "fixture-empty", body: EMPTY_BODY }),
  registry: REGISTRY,
  expectedBillableCents: 0,
  expectedTotalInclVatCents: 0,
};

export const SINGLE_SERVICE_TABLE: SowFixture = {
  name: "SINGLE_SERVICE_TABLE",
  doc: doc({ id: "fixture-doc-1", body: SINGLE_SERVICE_TABLE_BODY }),
  registry: REGISTRY,
  expectedBillableCents: 200000,
  expectedTotalInclVatCents: 230000, // 200000 * 1.15
};

export const MULTI_LINE_WITH_DISCOUNT: SowFixture = {
  name: "MULTI_LINE_WITH_DISCOUNT",
  doc: doc({ id: "fixture-multi", body: MULTI_LINE_BODY }),
  registry: REGISTRY,
  // round(1.5*33333)=50000 ; 3*40000=120000 ; subtotal 170000
  expectedBillableCents: 170000,
  expectedTotalInclVatCents: 195500, // 170000 * 1.15
};

/** Per-client override + a what-if scenario that bumps VAT to 25%. */
export const CLIENT_OVERRIDE: SowFixture = {
  name: "CLIENT_OVERRIDE",
  doc: doc({ id: "fixture-doc-2", body: SINGLE_SERVICE_TABLE_BODY }),
  registry: REGISTRY,
  clientOverrides: { "client.name": "Client A Pty" },
  scenarios: [
    { name: "Client A (15% VAT)", overrides: {} },
    { name: "WHAT-IF 25% VAT", description: "Stress-test margin", overrides: { "agency.vat_pct": 25 } },
  ],
  expectedBillableCents: 200000,
  expectedTotalInclVatCents: 230000,
};

/** A negotiated R0 hourly rate must be honoured, not reverted to the default. */
export const FALSE_ZERO_OVERRIDE: SowFixture = {
  name: "FALSE_ZERO_OVERRIDE",
  doc: doc({
    id: "fixture-zero",
    body: [proseSection("rate", 0, "Hourly rate: {{pricing.hourly_rate}}.")],
    variable_overrides: { "pricing.hourly_rate": 0 },
  }),
  registry: REGISTRY,
  expectedBillableCents: 0,
  expectedTotalInclVatCents: 0,
};

export const UNKNOWN_VARIABLE: SowFixture = {
  name: "UNKNOWN_VARIABLE",
  doc: doc({ id: "fixture-doc-3", body: UNKNOWN_VARIABLE_BODY }),
  registry: REGISTRY,
  expectedBillableCents: 0,
  expectedTotalInclVatCents: 0,
};

export const ALL_FIXTURES: SowFixture[] = [
  EMPTY_TEMPLATE,
  SINGLE_SERVICE_TABLE,
  MULTI_LINE_WITH_DISCOUNT,
  CLIENT_OVERRIDE,
  FALSE_ZERO_OVERRIDE,
  UNKNOWN_VARIABLE,
];

export const FIXTURE_BY_DOC_ID: Record<string, SowFixture> = Object.fromEntries(
  ALL_FIXTURES.map((f) => [f.doc.id, f]),
);
