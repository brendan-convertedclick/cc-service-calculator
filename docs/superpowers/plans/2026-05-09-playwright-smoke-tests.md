# Playwright Smoke Test Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Playwright and build a smoke test suite that verifies all 17 app pages load correctly against the live dev server, with no login required.

**Architecture:** A single `e2e/smoke.spec.ts` file groups tests by static routes (direct URL navigation) and dynamic routes (navigate-from-list click-through). A shared `e2e/helpers/shell.ts` provides the `waitForShell()` helper and `smokeCheck()` utility used by every test. Playwright's `webServer` config auto-starts the Vite dev server so no manual setup is needed.

**Tech Stack:** `@playwright/test`, Chromium, Vite dev server on port 5174. Auth is already bypassed in dev mode — `RequireAuth` renders `<Outlet />` unconditionally and `AuthContext` injects a fake `DEV_SESSION`.

**Spec:** `docs/superpowers/specs/2026-05-09-playwright-smoke-tests-design.md`

---

## File map

**New files:**
- `playwright.config.ts` — Playwright config, Chromium only, webServer auto-start
- `e2e/helpers/shell.ts` — `waitForShell()` + `smokeCheck()` shared utilities
- `e2e/smoke.spec.ts` — all 17 page smoke tests

**Modified files:**
- `package.json` — add `e2e` and `e2e:ui` scripts
- `.gitignore` — add `playwright-report/` and `test-results/`

---

## Task 1: Install Playwright + scaffold config

**Files:**
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install `@playwright/test` as a dev dependency**

```bash
npm install --save-dev @playwright/test
```

Expected: `@playwright/test` appears in `devDependencies` in `package.json`.

- [ ] **Step 2: Install the Chromium browser**

```bash
npx playwright install chromium
```

Expected: Chromium downloads and installs (~150 MB). Output ends with "chromium installed".

- [ ] **Step 3: Create `playwright.config.ts`**

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 4: Add scripts to `package.json`**

In the `"scripts"` object, add after `"test:watch"`:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui",
```

- [ ] **Step 5: Update `.gitignore`**

Add these two lines to `.gitignore`:

```
playwright-report/
test-results/
```

- [ ] **Step 6: Create the `e2e/` directory with a `.gitkeep`**

```bash
mkdir -p e2e/helpers
```

- [ ] **Step 7: Verify Playwright can find the config**

```bash
npx playwright test --list 2>&1 | head -5
```

Expected: Output shows "0 tests found" (no test files yet) — not an error.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.ts package.json package-lock.json .gitignore
git commit -m "chore(e2e): install Playwright + scaffold config"
```

---

## Task 2: Shared shell helper

**Files:**
- Create: `e2e/helpers/shell.ts`

- [ ] **Step 1: Create `e2e/helpers/shell.ts`**

```ts
// e2e/helpers/shell.ts
import { expect, type Page } from "@playwright/test";

/** The AppShell sidebar — proves React mounted and auth bypass worked */
const NAV_SIDEBAR = "aside nav";

/** Regex matching any crash boundary text */
const CRASH_TEXT = /something went wrong|unexpected error/i;

/**
 * Waits for the AppShell sidebar to be visible.
 * Every authenticated page uses AppShell, so this confirms:
 * - React app mounted
 * - Auth bypass (RequireAuth renders Outlet in dev mode)
 * - Routing resolved to a page inside the shell
 */
export async function waitForShell(page: Page): Promise<void> {
  await page.waitForSelector(NAV_SIDEBAR, { state: "visible", timeout: 15_000 });
}

/**
 * Standard smoke check for any route:
 * 1. Registers a JS error listener (before navigation, so nothing is missed)
 * 2. Navigates to the URL
 * 3. Waits for the app shell
 * 4. Asserts no crash boundary rendered
 * Returns the collected JS errors for the caller to assert on.
 */
export async function smokeCheck(page: Page, url: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(url);
  await waitForShell(page);
  await expect(page.getByText(CRASH_TEXT)).toHaveCount(0);

  return errors;
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/helpers/shell.ts
git commit -m "feat(e2e): shared waitForShell + smokeCheck helpers"
```

---

## Task 3: Static route smoke tests

**Files:**
- Create: `e2e/smoke.spec.ts`

These 13 routes are navigated to directly. No click-through required. Each test uses `smokeCheck()` then asserts a page-specific `h1` or unique element.

- [ ] **Step 1: Create `e2e/smoke.spec.ts` with static route tests**

```ts
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
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Departments" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
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
```

- [ ] **Step 2: Start the dev server in one terminal (if not already running)**

```bash
npm run dev
```

Expected: Server starts on http://localhost:5174. Leave it running.

- [ ] **Step 3: Run only the static route tests**

```bash
npx playwright test e2e/smoke.spec.ts --grep "Static routes" --reporter=list
```

Expected: 13 tests pass. If any fail with "locator.waitFor: Timeout" or "Locator expected to be visible", the selector didn't match — check the error message for the actual page content and adjust the assertion in that test. Common fix: `getByRole("heading", { name: "X" })` → `page.getByText("X").first()` if the heading level differs.

- [ ] **Step 4: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "feat(e2e): static route smoke tests — 13 pages"
```

---

## Task 4: Dynamic route smoke tests

**Files:**
- Modify: `e2e/smoke.spec.ts`

These 4 tests navigate from a list page and click through to a detail. Each gracefully skips if the list is empty (clean DB).

- [ ] **Step 1: Add dynamic route tests to `e2e/smoke.spec.ts`**

Append this block after the closing `});` of the static routes describe block:

```ts
// ─── Dynamic routes — navigate from list ──────────────────────────────────────

test.describe("Dynamic routes — click-through from list", () => {

  test("/services/:id — Service detail via list click", async ({ page }) => {
    const errors = await smokeCheck(page, "/services");
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();

    // Find the first service row link. ServicesList renders <tr> rows inside a table.
    const firstRow = page.locator("table tbody tr").first();
    const rowCount = await page.locator("table tbody tr").count();
    if (rowCount === 0) {
      test.skip(true, "No services in DB — skipping detail page test");
      return;
    }

    await firstRow.click();
    await page.waitForURL(/\/services\/.+/, { timeout: 10_000 });
    // ServiceDetail h1 shows the service name — just assert it's present
    await expect(page.locator("h1")).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/projects/:id — Project detail via list click", async ({ page }) => {
    const errors = await smokeCheck(page, "/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    // Projects page renders Cards wrapped in <Link to="/projects/:id">
    const firstProjectCard = page.locator("a[href^='/projects/']").first();
    const cardCount = await page.locator("a[href^='/projects/']").count();
    if (cardCount === 0) {
      test.skip(true, "No projects in DB — skipping detail page test");
      return;
    }

    await firstProjectCard.click();
    await page.waitForURL(/\/projects\/.+/, { timeout: 10_000 });
    await expect(page.locator("h1")).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/inbox/:briefId — Brief conversation via list click", async ({ page }) => {
    const errors = await smokeCheck(page, "/inbox");
    await expect(page.getByRole("tab", { name: "All" })).toBeVisible();

    // Switch to All tab to see every brief regardless of assignment
    await page.getByRole("tab", { name: "All" }).click();

    // BriefList renders <Link to="/inbox/:id"> for each brief
    const firstBriefLink = page.locator("a[href^='/inbox/']").first();
    const linkCount = await page.locator("a[href^='/inbox/']").count();
    if (linkCount === 0) {
      test.skip(true, "No briefs in DB — skipping conversation test");
      return;
    }

    await firstBriefLink.click();
    await page.waitForURL(/\/inbox\/.+/, { timeout: 10_000 });
    // BriefConversation sheet opens — check for the sheet content
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("/clients/:clientId/projects/:projectId — ProjectScopeView via sidebar", async ({ page }) => {
    const errors = await smokeCheck(page, "/");

    // The AppShell sidebar has ClientNavSection links to /clients/:id/projects/:id
    const firstProjectLink = page
      .locator("aside nav a[href*='/projects/']")
      .first();
    const linkCount = await page
      .locator("aside nav a[href*='/projects/']")
      .count();

    if (linkCount === 0) {
      test.skip(true, "No client projects in sidebar — skipping ProjectScopeView test");
      return;
    }

    await firstProjectLink.click();
    await page.waitForURL(/\/clients\/.+\/projects\/.+/, { timeout: 10_000 });

    // ProjectScopeView renders a breadcrumb: "ClientName > ProjectName"
    // The ChevronRight separator is the clearest indicator of the three-pane header
    await expect(page.locator("svg.lucide-chevron-right")).toBeVisible();
    // Activity tab should be selected by default
    await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

});
```

- [ ] **Step 2: Run the full test suite**

```bash
npx playwright test --reporter=list
```

Expected: 17 tests pass (13 static + 4 dynamic). Dynamic tests may show `[skipped]` if the DB has no data — this is correct behaviour, not a failure.

If the `lucide-chevron-right` SVG selector fails, replace it with:
```ts
await expect(page.getByRole("link", { name: /ACME|Pebble|Quartz/i }).first()).toBeVisible();
```
(Match the client name visible in the breadcrumb instead.)

- [ ] **Step 3: Open the HTML report to visually verify**

```bash
npx playwright show-report
```

Expected: Browser opens showing all tests green (or yellow for skipped). No red failures.

- [ ] **Step 4: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "feat(e2e): dynamic route smoke tests — navigate-from-list for 4 pages"
```

---

## Task 5: Final verification + CI readiness check

**Files:** None (verification only)

- [ ] **Step 1: Run the full suite with the HTML reporter for a clean baseline**

```bash
npx playwright test
```

Expected output (approximate):
```
Running 17 tests using 17 workers
  17 passed (or X passed, Y skipped)
```

No failures allowed. Skips are acceptable.

- [ ] **Step 2: Verify `npx tsc --noEmit` still passes (no type regressions)**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify the existing Vitest suite still passes**

```bash
npm test
```

Expected: All existing tests pass. Playwright install should not affect Vitest.

- [ ] **Step 4: Commit verification result**

```bash
git add -A
git status
```

Expected: `nothing to commit` — all files were committed in earlier tasks.

---

## Self-review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| Install + `playwright.config.ts` | Task 1 |
| `webServer` auto-start | Task 1 (config) |
| `e2e/helpers/shell.ts` with `waitForShell()` + `smokeCheck()` | Task 2 |
| 13 static routes tested | Task 3 |
| 4 dynamic navigate-from-list routes | Task 4 |
| Graceful skip when DB empty | Task 4 (all 4 dynamic tests) |
| `pageerror` JS error capture | Task 2 (`smokeCheck`) + Task 3/4 (every test) |
| No crash boundary assertion | Task 2 (`smokeCheck`) |
| `playwright-report/` and `test-results/` gitignored | Task 1 |
| `e2e` and `e2e:ui` npm scripts | Task 1 |
| Chromium only | Task 1 (config) |
| `retries: 1` | Task 1 (config) |

All spec requirements covered. No placeholders.
