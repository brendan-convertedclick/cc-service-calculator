import { test, expect } from "@playwright/test";

test("data health runs the reconciliation and reports a confidence figure", async ({ page }) => {
  await page.goto("/data-health");
  await expect(page.getByRole("heading", { name: "Data health" })).toBeVisible();
  // It does not run on its own: reading the whole Clients space is a button press.
  await expect(page.getByText(/Nothing checked yet/)).toBeVisible();

  await page.getByRole("button", { name: /run the check/i }).click();
  await expect(page.getByText("Confidence")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/of client work closed in ClickUp/)).toBeVisible();
  // A percentage, not a blank card.
  await expect(page.locator("text=/^\\d+(\\.\\d+)?%$/").first()).toBeVisible();
});
