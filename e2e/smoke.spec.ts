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
