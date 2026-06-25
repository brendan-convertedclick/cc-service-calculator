import { expect, type Page } from "@playwright/test";

// Inline fixtures (kept consistent with src/test/fixtures/sow). Defined here so
// the Playwright loader never has to resolve the app's "@/" path alias.

export const REGISTRY = [
  { id: "client.name", key: "client.name", label: "Client name", type: "text", scope: "global", template_id: null, default_value: null, expression: null, enum_options: null },
  { id: "document.date", key: "document.date", label: "Document date", type: "date", scope: "global", template_id: null, default_value: null, expression: null, enum_options: null },
  { id: "agency.vat_pct", key: "agency.vat_pct", label: "VAT %", type: "percent", scope: "global", template_id: null, default_value: 15, expression: null, enum_options: null },
  { id: "pricing.hourly_rate", key: "pricing.hourly_rate", label: "Hourly rate (cents)", type: "currency_cents", scope: "global", template_id: null, default_value: 0, expression: null, enum_options: null },
  { id: "pricing.total_incl_vat_cents", key: "pricing.total_incl_vat_cents", label: "Total incl VAT (cents)", type: "computed", scope: "computed", template_id: null, default_value: null, expression: "pricing.subtotal_cents * (1 + agency.vat_pct / 100)", enum_options: null },
];

const SINGLE_SERVICE_TABLE_BODY = [
  { id: "intro", type: "prose", ordinal: 0, props: { heading: "Overview", markdown: "Scope of work for **{{client.name}}**." } },
  {
    id: "svc-1",
    type: "service_table",
    ordinal: 1,
    props: {
      showCostColumn: true,
      lines: [
        { taskRef: "a", name: "Landing page", qty: 2, unitCents: 50000, disposition: "new_billable" },
        { taskRef: "b", name: "Email automation", qty: 1, unitCents: 100000, disposition: "new_billable" },
        { taskRef: "c", name: "Monthly retainer hours", qty: 1, unitCents: 80000, disposition: "in_agreed_scope" },
        { taskRef: "d", name: "TV advert", qty: 1, unitCents: 500000, disposition: "out_of_scope" },
      ],
    },
  },
];

const UNKNOWN_VARIABLE_BODY = [
  { id: "intro", type: "prose", ordinal: 0, props: { heading: "Overview", markdown: "Prepared for {{client.name}} — ref {{client.unknown_field}}." } },
];

function docRow(id: string, body: unknown) {
  return {
    id,
    template_id: null,
    client_id: "client-1",
    brief_id: null,
    quote_id: null,
    title: "Test SOW",
    body,
    variable_overrides: {},
    status: "draft",
    rendered_pdf_url: null,
    schema_version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

export const DOCS: Record<string, ReturnType<typeof docRow>> = {
  "fixture-doc-1": docRow("fixture-doc-1", SINGLE_SERVICE_TABLE_BODY),
  "fixture-doc-3": docRow("fixture-doc-3", UNKNOWN_VARIABLE_BODY),
};

/** SINGLE_SERVICE_TABLE expectations. */
export const EXPECTED = {
  billableCents: 200000,
  totalInclVat15: 230000,
  totalInclVat25: 250000,
};

/**
 * Stub only the not-yet-migrated sow_* tables (and the clients.variable_overrides
 * column). Everything else — real Supabase auth, the AppShell nav queries, the
 * services catalogue — passes through, exactly like the existing smoke tests.
 */
export async function fixtureRoutes(
  page: Page,
  opts: { doc: ReturnType<typeof docRow>; clientOverrides?: Record<string, unknown> },
): Promise<void> {
  const clientOverrides = opts.clientOverrides ?? {};
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.includes("/sow_documents")) {
      if (method === "PATCH") {
        const patch = (req.postDataJSON() as Record<string, unknown>) ?? {};
        return json({ ...opts.doc, ...patch });
      }
      return json(opts.doc); // maybeSingle → single object
    }
    if (url.includes("/sow_variables")) return json(REGISTRY);
    if (url.includes("/sow_library_items")) return json([]);
    if (url.includes("/clients") && url.includes("variable_overrides")) {
      return json({ variable_overrides: clientOverrides });
    }
    return route.continue();
  });
}

/** Read the exact integer cents off a data-cents node (locale-proof). */
export async function getSowCents(page: Page, testId: string): Promise<number> {
  const v = await page.getByTestId(testId).getAttribute("data-cents");
  return Number(v);
}

export async function expectSowCents(page: Page, testId: string, cents: number): Promise<void> {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible();
  await expect(el).toHaveAttribute("data-cents", String(cents));
}
