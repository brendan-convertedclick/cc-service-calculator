# Design: Playwright Smoke Test Suite

**Date:** 2026-05-09
**Status:** Draft — awaiting plan
**Author:** Brendan Gunn

---

## 1. Purpose

Verify every page in the app loads without crashing after any code change. Tests run against the live dev server (port 5174) where Supabase auth is bypassed — `RequireAuth` renders `<Outlet />` unconditionally in dev mode and `AuthContext` injects a fake `DEV_SESSION`. No login step needed.

Tests are smoke tests only: they confirm the app renders and shows meaningful content. They do not assert business logic, form submissions, or data mutations.

---

## 2. What "loads properly" means

For every page, the test verifies:

1. **HTTP navigation succeeds** — Playwright navigates to the URL without a network error
2. **App shell renders** — the left sidebar nav is visible (proves the React app mounted and auth bypass worked)
3. **No uncaught JS errors** — `page.on('pageerror')` captures any unhandled exceptions; test fails if one fires
4. **No crash boundary** — no element containing "Something went wrong" or "Unexpected error" is visible
5. **Page-specific element present** — a heading, tab, table, or form element unique to that page is visible, confirming the correct component rendered

---

## 3. File structure

```
playwright.config.ts              — Playwright config (root)
e2e/
  smoke.spec.ts                   — all page smoke tests
  helpers/
    shell.ts                      — shared selectors + waitForShell() helper
```

`.gitignore` additions:
```
playwright-report/
test-results/
```

`package.json` script addition:
```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

---

## 4. Playwright config

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

Key choices:
- **Chromium only** — smoke tests don't need cross-browser coverage
- `reuseExistingServer: true` — if the dev server is already running locally, don't start a second one
- `retries: 1` — one retry for flaky Supabase fetch timing
- `fullyParallel: true` — all page tests are independent reads, safe to parallelise

---

## 5. Shared helper

```ts
// e2e/helpers/shell.ts
import type { Page } from "@playwright/test";

/** Selector that proves the AppShell sidebar rendered */
export const NAV_SIDEBAR = "aside nav";

/** Selector for a crash boundary message */
export const CRASH_TEXT = /something went wrong|unexpected error/i;

/**
 * Waits for the AppShell sidebar to be visible.
 * Confirms React mounted, auth bypass worked, and routing resolved.
 */
export async function waitForShell(page: Page) {
  await page.waitForSelector(NAV_SIDEBAR, { state: "visible" });
}
```

---

## 6. Test coverage

### 6.1 Static routes — direct URL

All 13 of these are navigated to directly. No real data needed.

| Route | Page-specific assertion |
|---|---|
| `/` | Text "Dashboard" visible |
| `/inbox` | Tab list (Mine / Unassigned / Waiting / All) visible |
| `/clients` | Heading "Clients" or clients table visible |
| `/projects` | Heading "Projects" or projects table visible |
| `/services` | Services table or "Services" heading |
| `/rules` | "Rules" heading |
| `/departments` | "Departments" heading |
| `/team` | "Team" heading |
| `/guides` | "Guides" heading |
| `/settings` | "Settings" heading |
| `/settings/gmail` | Gmail settings content (token input or connected state) |
| `/briefs/new` | New brief form (subject/body input visible) |
| `/services/new` | Service name input visible |

### 6.2 Dynamic routes — navigate from list

These require at least one row of real data in Supabase. Each test first visits the list page, checks at least one row exists (skips gracefully if not), then clicks through.

| Flow | List assertion | Detail assertion |
|---|---|---|
| `/services` → first row | Table has ≥1 row | URL matches `/services/:id`, service name input visible |
| `/projects` → first row | Table/list has ≥1 row | URL matches `/projects/:id`, project heading visible |
| `/inbox` → first brief | Brief list has ≥1 item | Conversation sheet or brief subject visible |

### 6.3 New feature — ProjectScopeView

Reached via the sidebar client nav (ClientNavSection). After loading `/`, the sidebar is checked for at least one project link under a client header. If found, clicks it and asserts `/clients/:clientId/projects/:projectId` renders with the three-pane layout (breadcrumb visible).

Graceful skip if no clients/projects exist in the DB.

### 6.4 Routes skipped in smoke suite

| Route | Why skipped |
|---|---|
| `/login` | Auth bypass means login is never needed in dev; page still exists but isn't part of the authenticated app flow |
| `/briefs/:id/scope` | Requires a brief with a specific state; covered by unit tests |
| `/briefs/:id/builder` | Same — requires brief in `scoped` status |
| `/quotes/:id` | Reached via the project builder flow; complex state prerequisite |
| `/quotes/:id/send` | Same |

These routes are not dead — they're just guarded by workflow state that's difficult to set up in a smoke test. They can be added to a separate `e2e/flows.spec.ts` when workflow integration tests are needed.

---

## 7. Error handling strategy

Each test registers a `pageerror` listener before navigation:

```ts
const errors: string[] = [];
page.on("pageerror", (err) => errors.push(err.message));
// ... navigate and assert ...
expect(errors, `JS errors on ${url}`).toHaveLength(0);
```

This catches:
- Unhandled promise rejections
- Runtime TypeErrors from bad data shapes
- React render errors that escape error boundaries

Console warnings are **not** captured — only thrown errors that would show as red in the browser console.

---

## 8. Graceful skips for empty data

For the three dynamic-route tests and the ProjectScopeView test, the test uses Playwright's `skip` when the list is empty:

```ts
const rowCount = await page.locator("table tbody tr").count();
if (rowCount === 0) {
  test.skip(true, "No data in DB — skipping detail page test");
}
```

This means the suite passes cleanly on a fresh DB without false positives.

---

## 9. Out of scope

- Cross-browser testing (Firefox, Safari) — add when needed
- Visual regression snapshots — separate concern
- Form submission / data mutation tests — separate `e2e/flows.spec.ts`
- Accessibility audits — separate tooling (axe-playwright)
- CI pipeline integration — separate task after tests are proven locally
- Mock Supabase / network interception — smoke tests use real data by design
