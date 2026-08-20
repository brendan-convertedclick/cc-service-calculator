import { expect, test } from "@playwright/test";
import { smokeCheck } from "./helpers/shell";

/**
 * /time — per-client meeting hours, plus the unmapped-domain queue that makes
 * them accurate.
 *
 * Read-only. Asserts structure, never a specific client or number: the page
 * runs against the dev database and the figures move every time the calendar
 * sync runs.
 */
test("client time view renders its table and domain queue", async ({ page }) => {
  const errors = await smokeCheck(page, "/time");

  await expect(page.getByRole("heading", { name: "Time per client" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sync calendars/i })).toBeVisible();

  // The by-client table always renders, even with nothing attributed yet.
  await expect(page.getByRole("heading", { name: "By client" })).toBeVisible();

  // Six months of columns plus Client, Total and Client-facing.
  const headers = page.locator("thead th");
  await expect(headers.first()).toHaveText("Client");
  await expect(headers).toHaveCount(9);

  expect(errors).toEqual([]);
});
