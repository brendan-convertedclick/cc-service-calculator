// e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";
import { smokeCheck } from "./helpers/shell";

// ─── Static routes ────────────────────────────────────────────────────────────

test.describe("Static routes — load without crash", () => {

  test("/ — Dashboard", async ({ page }) => {
    const errors = await smokeCheck(page, "/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/inbox — Inbox tabs", async ({ page }) => {
    const errors = await smokeCheck(page, "/inbox");
    await expect(page.getByRole("tab", { name: "Mine" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/clients — Clients list", async ({ page }) => {
    const errors = await smokeCheck(page, "/clients");
    await expect(page.getByRole("heading", { name: "Clients", exact: true, level: 1 })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/projects — Projects list", async ({ page }) => {
    const errors = await smokeCheck(page, "/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/services — Services list", async ({ page }) => {
    const errors = await smokeCheck(page, "/services");
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/rules — Rules", async ({ page }) => {
    const errors = await smokeCheck(page, "/rules");
    await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/departments — Departments", async ({ page }) => {
    const errors = await smokeCheck(page, "/departments");
    await expect(page.getByRole("heading", { name: "Departments", exact: true, level: 1 })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/team — Team", async ({ page }) => {
    const errors = await smokeCheck(page, "/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/guides — Guides", async ({ page }) => {
    const errors = await smokeCheck(page, "/guides");
    await expect(page.getByRole("heading", { name: "Guides" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/settings — Settings", async ({ page }) => {
    const errors = await smokeCheck(page, "/settings");
    // The Settings page renders after useSettings resolves.
    // In e2e (no real auth session) the query may stay in loading state,
    // so we check either the h1 or the loading placeholder — both confirm
    // the route mounted without crashing.
    const heading = page.getByRole("heading", { name: "Settings", level: 1 });
    const loading = page.getByText("Loading…");
    await expect(heading.or(loading)).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/settings/gmail — Connect Gmail", async ({ page }) => {
    const errors = await smokeCheck(page, "/settings/gmail");
    await expect(page.getByRole("heading", { name: "Connect Gmail" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/escalations — Owner escalations queue", async ({ page }) => {
    const errors = await smokeCheck(page, "/escalations");
    await expect(page.getByRole("heading", { name: "Escalations", level: 1 })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/briefs/new — New Brief form", async ({ page }) => {
    const errors = await smokeCheck(page, "/briefs/new");
    // Subject label confirms the form rendered
    await expect(page.getByLabel("Subject")).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/services/new — New Service form", async ({ page }) => {
    const errors = await smokeCheck(page, "/services/new");
    await expect(page.getByRole("heading", { name: "New service" })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

});

// ─── Dynamic routes — navigate from list ──────────────────────────────────────

test.describe("Dynamic routes — click-through from list", () => {

  test("/services/:id — Service detail via list click", async ({ page }) => {
    const errors = await smokeCheck(page, "/services");
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();

    // ServicesList renders <tr> rows inside a <table>
    const rowCount = await page.locator("table tbody tr").count();
    if (rowCount === 0) {
      test.skip(true, "No services in DB — skipping detail page test");
      return;
    }

    await page.locator("table tbody tr").first().click();
    await page.waitForURL(/\/services\/.+/, { timeout: 10_000 });
    // ServiceDetail h1 shows the service name — just assert any h1 is present
    await expect(page.locator("h1")).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/projects/:id — Project detail via list click", async ({ page }) => {
    const errors = await smokeCheck(page, "/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    // Projects page renders Cards wrapped in <Link to="/projects/:id">
    const cardCount = await page.locator("a[href^='/projects/']").count();
    if (cardCount === 0) {
      test.skip(true, "No projects in DB — skipping detail page test");
      return;
    }

    await page.locator("a[href^='/projects/']").first().click();
    await page.waitForURL(/\/projects\/.+/, { timeout: 10_000 });
    await expect(page.locator("h1")).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/inbox/:briefId — Brief conversation via list click", async ({ page }) => {
    const errors = await smokeCheck(page, "/inbox");
    await expect(page.getByRole("tab", { name: "Mine" })).toBeVisible();

    // Switch to All tab to see every brief regardless of assignment
    await page.getByRole("tab", { name: "All" }).click();

    // BriefList renders <Link to="/inbox/:id"> for each brief
    const linkCount = await page.locator("a[href^='/inbox/']").count();
    if (linkCount === 0) {
      test.skip(true, "No briefs in DB — skipping conversation test");
      return;
    }

    await page.locator("a[href^='/inbox/']").first().click();
    await page.waitForURL(/\/inbox\/.+/, { timeout: 10_000 });
    // BriefConversation sheet opens — check for the dialog role
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/clients/:clientId/projects/:projectId — ProjectScopeView via sidebar", async ({ page }) => {
    const errors = await smokeCheck(page, "/");

    // The AppShell sidebar has ClientNavSection links to /clients/:id/projects/:id
    const linkCount = await page
      .locator("aside nav a[href*='/projects/']")
      .count();

    if (linkCount === 0) {
      test.skip(true, "No client projects in sidebar — skipping ProjectScopeView test");
      return;
    }

    await page.locator("aside nav a[href*='/projects/']").first().click();
    await page.waitForURL(/\/clients\/.+\/projects\/.+/, { timeout: 10_000 });

    // ProjectScopeView: Activity tab selected by default
    await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

});
