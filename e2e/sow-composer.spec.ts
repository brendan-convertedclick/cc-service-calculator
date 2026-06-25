import { test, expect } from "@playwright/test";
import { waitForShell } from "./helpers/shell";
import { DOCS, EXPECTED, expectSowCents, fixtureRoutes, getSowCents } from "./helpers/sow";

// Scope Composer — visual SOW builder. The sow_* tables are stubbed (the
// migration is shipped but not yet applied to prod); auth, the AppShell, and
// the services catalogue use the real dev session, like the smoke suite.

test.describe("Scope Composer", () => {
  test("loads the two-pane editor and renders the service-table totals", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixtureRoutes(page, { doc: DOCS["fixture-doc-1"] });

    await page.goto("/sow/docs/fixture-doc-1");
    await waitForShell(page);

    // Left pane: the seeded sections render as editable cards.
    await expect(page.getByTestId("section-svc-1")).toBeVisible();
    // Right pane: billable subtotal (200000) and grand total incl 15% VAT (230000).
    await expectSowCents(page, "section-subtotal-svc-1", EXPECTED.billableCents);
    await expectSowCents(page, "sow-total", EXPECTED.totalInclVat15);

    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("switching scenarios re-resolves the grand total live", async ({ page }) => {
    await fixtureRoutes(page, { doc: DOCS["fixture-doc-1"] });
    await page.goto("/sow/docs/fixture-doc-1");
    await waitForShell(page);

    await expectSowCents(page, "sow-total", EXPECTED.totalInclVat15); // 15% VAT baseline
    const baseline = await getSowCents(page, "sow-total");

    // Pick the "WHAT-IF 25% VAT" scenario from the runner.
    await page.getByTestId("scenarios-select").click();
    await page.getByRole("option", { name: "WHAT-IF 25% VAT" }).click();

    await expectSowCents(page, "sow-total", EXPECTED.totalInclVat25); // recomputed at 25%
    expect(await getSowCents(page, "sow-total")).not.toBe(baseline);
  });

  test("a document-level variable override flows through to the preview and autosaves", async ({
    page,
  }) => {
    await fixtureRoutes(page, { doc: DOCS["fixture-doc-1"] });
    await page.goto("/sow/docs/fixture-doc-1");
    await waitForShell(page);

    const patch = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/sow_documents") && r.method() === "PATCH",
    );

    await page.getByRole("textbox", { name: "Client name", exact: true }).fill("Acme Pty");

    // Live preview reflects the override immediately.
    await expect(page.getByTestId("chip-client.name")).toHaveText("Acme Pty");

    // Debounced autosave persists it into the document's variable_overrides.
    const req = await patch;
    expect(JSON.stringify(req.postDataJSON())).toContain("Acme Pty");
  });

  test("an unknown variable renders a red chip and blocks finalize", async ({ page }) => {
    await fixtureRoutes(page, { doc: DOCS["fixture-doc-3"] });
    await page.goto("/sow/docs/fixture-doc-3");
    await waitForShell(page);

    await expect(page.getByTestId("unknown-var-client.unknown_field")).toBeVisible();

    await page.getByRole("button", { name: /Validate/i }).click();
    await expect(page.getByTestId("lint-failures")).toBeVisible();
    await expect(page.getByTestId("mark-final")).toBeDisabled();
  });
});
