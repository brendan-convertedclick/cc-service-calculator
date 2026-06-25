import { expect, type Page } from "@playwright/test";

/** The AppShell sidebar rail — proves React mounted and auth bypass worked.
 * (The nav links live directly in the <aside> rail; an earlier `aside nav`
 * selector went stale when the shell was restructured.) */
const NAV_SIDEBAR = "aside";

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
