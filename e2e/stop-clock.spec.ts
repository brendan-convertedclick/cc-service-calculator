import { expect, test } from "@playwright/test";
import { smokeCheck } from "./helpers/shell";

/**
 * /client-signoffs → "Who's holding it up": the turnaround view.
 *
 * Read-only. It runs against the dev database, where every figure moves each
 * time the ClickUp status sync runs and the running clocks grow by the minute,
 * so nothing here asserts a number. What it pins is the argument the tab
 * exists to make and the shape that carries it:
 *
 *   - the statement leads, and it leads on a DATE, not a duration
 *   - the runway is anchored on a shared DUE line with a LATE BY column
 *   - both counts survive: how far past its date, and what is left of that
 *   - the ledger is still underneath, and the scope filter drives all three
 */

async function openWaitingTab(page: import("@playwright/test").Page) {
  const errors = await smokeCheck(page, "/client-signoffs");
  await page.getByRole("tab", { name: /Who's holding it up/i }).click();
  return errors;
}

/**
 * The chart, once it has had a chance to render. `isVisible()` answers
 * immediately and answered "no" on a tab that was still mounting, which
 * skipped a passing test — so wait, and only then decide there is nothing
 * dated in the database to draw.
 */
async function runwayOrNull(page: import("@playwright/test").Page) {
  const chart = page.getByRole("img", { name: /runway against its due date/i });
  try {
    await chart.waitFor({ state: "visible", timeout: 8_000 });
    return chart;
  } catch {
    return null;
  }
}

test("the turnaround tab leads with the statement, then the runway, then the ledger", async ({
  page,
}) => {
  const errors = await openWaitingTab(page);

  // The statement. It is allowed to say a date has moved or that none has —
  // both are true sentences and which one shows depends on live data.
  await expect(
    page.getByText(/of deadline|No deadline has moved|Nothing open here/i).first(),
  ).toBeVisible();

  // The runway, or an honest refusal to draw one.
  const chart = page.getByRole("img", { name: /runway against its due date/i });
  const noDates = page.getByText(/no runway to draw/i);
  await expect(chart.or(noDates).first()).toBeVisible();

  // The ledger underneath, with its two clocks.
  await expect(page.getByRole("columnheader", { name: "On client" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "On us" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the runway is anchored on a due line and reports what survives it", async ({ page }) => {
  await openWaitingTab(page);

  const chart = await runwayOrNull(page);
  test.skip(chart === null, "no dated tasks in the dev database right now");

  // The two axes of the whole idea: everything is measured against DUE, and
  // the far column says what is left once the client's days come off. A chart
  // with only one of these is either an excuse or the bug it replaced.
  await expect(chart!.getByText("DUE", { exact: true })).toBeVisible();
  await expect(chart!.getByText("LATE BY", { exact: true })).toBeVisible();
  await expect(chart!.getByText(/past its date/)).toBeVisible();

  // "the time we were given" is deliberately NOT asserted: it only renders
  // when the runway trough is wide enough to hold it without colliding with
  // the overrun caption, which depends on the data in front of you.
});

test("hovering a row says how much time we were given", async ({ page }) => {
  await openWaitingTab(page);

  const chart = await runwayOrNull(page);
  test.skip(chart === null, "no dated tasks in the dev database right now");

  // The hit areas are the transparent rects laid over each row.
  const hit = chart!.locator("rect[fill='transparent']").first();
  await hit.hover({ force: true });

  // "Given N days for Xh of work", or the honest fallback when the row was
  // drafted from an older ClickUp task and has no measurable runway.
  await expect(page.getByText(/Given \d+ days|No runway|No due date/).first()).toBeVisible();
  await expect(page.getByText("Late by", { exact: true })).toBeVisible();
});

test("the scope filter drives the statement, the runway and the ledger together", async ({
  page,
}) => {
  await openWaitingTab(page);

  // Closed work is history: nothing is waiting, so the statement must not
  // still be claiming days are being lost right now.
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await expect(
    page.getByText(/Nothing open here|No deadline has moved/i).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Everything", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Task" })).toBeVisible();
});
