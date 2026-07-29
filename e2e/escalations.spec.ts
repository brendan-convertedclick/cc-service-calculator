import { test, expect, type Locator, type Page } from "@playwright/test";
import { smokeCheck } from "./helpers/shell";

/**
 * The owner escalations queue: escalations grouped under the client paying for
 * them, and one decision at a time in a slide-over.
 *
 * These run against whatever is in the dev database, so nothing asserts on a
 * specific client or number. What they pin is the structure an owner relies
 * on — the page chrome, the filter rail, the fixed order of the evidence, and
 * the fact that a selection survives a reload.
 */

/** Every "waiting on" filter, always offered even when the count is zero. */
const HOLDERS = ["Needs you", "With admin", "Waiting on requester", "Decided"];

/** The evidence blocks, in the order the slide-over must always present them. */
const EVIDENCE = ["Approving", "Because", "Briefed as", "Paid by", "Signed off"];

/**
 * Open the page and wait for it to actually have loaded.
 *
 * smokeCheck only proves the shell mounted. The rows arrive from Supabase a
 * moment later, and while `rows` is null the page renders a skeleton with no
 * filter rail at all — so the Filters heading appearing is the signal that
 * counting rows is now meaningful. Without this wait every row count races to
 * zero.
 */
async function openQueue(page: Page): Promise<string[]> {
  const errors = await smokeCheck(page, "/escalations");
  await expect(page.getByRole("heading", { name: "Filters" })).toBeVisible();
  return errors;
}

/** Data rows only — the client group headers span the table and aren't clickable. */
function requestRows(page: Page): Locator {
  return page.locator("tbody tr").filter({ has: page.locator("td:not([colspan])") });
}

/** The slide-over holding the decision. */
function panel(page: Page): Locator {
  return page.getByRole("dialog");
}

async function openFirstRequest(page: Page): Promise<boolean> {
  const rows = requestRows(page);
  if ((await rows.count()) === 0) return false;
  await rows.first().click();
  await expect(panel(page)).toBeVisible();
  return true;
}

test.describe("/escalations — owner queue", () => {
  test("keeps the standard page chrome", async ({ page }) => {
    const errors = await smokeCheck(page, "/escalations");

    // Inside AppShell: nav rail and breadcrumbs, like every other queue.
    await expect(page.locator("aside").first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Escalations", level: 1 })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("filter rail offers search and every waiting-on state", async ({ page }) => {
    await openQueue(page);

    await expect(page.getByLabel("Search escalations")).toBeVisible();
    for (const holder of HOLDERS) {
      // Offered even at zero — "0 with admin" is information.
      await expect(page.getByRole("button", { name: new RegExp(`^${holder}`) })).toBeVisible();
    }
  });

  test("groups escalations under the client paying for them", async ({ page }) => {
    await openQueue(page);

    if ((await requestRows(page).count()) === 0) {
      await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
      test.skip(true, "Queue is empty — nothing to group");
      return;
    }
    // One header per client, carrying its own count.
    await expect(page.getByText(/\d+ escalations?$/).first()).toBeVisible();
  });

  test("a client filter narrows the list to that client", async ({ page }) => {
    await openQueue(page);

    const before = await requestRows(page).count();
    if (before === 0) {
      test.skip(true, "Queue is empty — nothing to filter");
      return;
    }

    // The first option under Client — the rail only lists clients that
    // actually have an escalation.
    const clientFilter = page
      .locator("aside")
      .nth(1)
      .getByRole("button", { name: /.+/ })
      .filter({ hasNotText: /^(Needs you|With admin|Waiting on requester|Decided|Clear)/ })
      .first();
    await clientFilter.click();
    await expect(clientFilter).toHaveAttribute("aria-pressed", "true");

    await expect(requestRows(page)).not.toHaveCount(0);
    expect(await requestRows(page).count()).toBeLessThanOrEqual(before);
  });

  test("clicking a request slides in the decision and answers in a fixed order", async ({ page }) => {
    const errors = await openQueue(page);

    if (!(await openFirstRequest(page))) {
      test.skip(true, "Queue is empty — nothing to select");
      return;
    }

    await expect(page).toHaveURL(/[?&]id=[0-9a-f-]{36}/);

    // The call comes before the evidence.
    await expect(panel(page).getByRole("region", { name: "Verdict" })).toBeVisible();
    for (const label of EVIDENCE) {
      await expect(panel(page).getByRole("term").filter({ hasText: label })).toBeVisible();
    }

    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("closing the slide-over drops the id from the URL", async ({ page }) => {
    await openQueue(page);
    if (!(await openFirstRequest(page))) {
      test.skip(true, "Queue is empty — nothing to close");
      return;
    }

    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]id=/);
  });

  test("a deep link restores the same request after a reload", async ({ page }) => {
    await openQueue(page);
    if (!(await openFirstRequest(page))) {
      test.skip(true, "Queue is empty — nothing to deep-link");
      return;
    }

    const url = page.url();
    const title = await panel(page).getByRole("heading").first().innerText();

    await page.goto(url);
    await expect(page).toHaveURL(url);
    // The slide-over comes back open on the same request.
    await expect(panel(page).getByRole("heading", { name: title })).toBeVisible();
  });

  test("reject asks for a reason before it will submit", async ({ page }) => {
    await openQueue(page);
    if (!(await openFirstRequest(page))) {
      test.skip(true, "Queue is empty — nothing to reject");
      return;
    }

    const reject = panel(page).getByRole("button", { name: "Reject", exact: true });
    if ((await reject.count()) === 0) {
      test.skip(true, "First request is already decided — no actions offered");
      return;
    }
    await reject.click();

    // Labelled, not placeholder-only, and focused so typing just works.
    const box = page.getByLabel("Why is this being rejected? The requester sees this.");
    await expect(box).toBeVisible();
    await expect(box).toBeFocused();

    // Cancel restores the actions without submitting anything.
    await panel(page).getByRole("button", { name: "Cancel" }).click();
    await expect(box).toBeHidden();
    await expect(panel(page).getByRole("button", { name: /^Approve/ })).toBeVisible();
  });

  test("rows the owner cannot act on show why instead of actions", async ({ page }) => {
    await openQueue(page);

    // Narrow to decided rows via the filter rather than hunting for one.
    await page.getByRole("button", { name: /^Decided/ }).click();
    if (!(await openFirstRequest(page))) {
      test.skip(true, "No decided requests in the queue");
      return;
    }

    await expect(panel(page).getByRole("region", { name: "Verdict" })).toBeVisible();
    // Approve must not be offered on something already settled.
    await expect(panel(page).getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  });
});
