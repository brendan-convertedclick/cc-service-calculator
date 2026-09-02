import { test, expect } from "@playwright/test";

test("retainers page renders both tabs and expands a client", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/retainers");
  await expect(page.getByRole("heading", { name: "Retainers" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /client work/i })).toBeVisible();
  await expect(page.getByRole("row", { name: /client work/i })).toBeVisible();

  const firstClient = page.getByRole("button", { name: /^Show retainers for / }).first();
  await firstClient.click();
  await expect(page.getByRole("button", { name: /^Hide retainers for / }).first()).toBeVisible();

  await page.getByRole("tab", { name: /^Internal/i }).click();
  await expect(page.getByRole("row", { name: /^Internal/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("recurring tasks are their own book, not part of the retainer one", async ({ page }) => {
  await page.goto("/retainers");
  const clientTotals = await page.getByRole("row", { name: /client work/i }).textContent();
  await page.getByRole("tab", { name: /recurring tasks/i }).click();
  const recurringTotals = await page.getByRole("row", { name: /recurring tasks/i }).textContent();
  // Two different books: the totals rows cannot be the same string.
  expect(recurringTotals).not.toEqual(clientTotals);
  await expect(page.getByRole("button", { name: /^Show retainers for / }).first()).toBeVisible();
});
