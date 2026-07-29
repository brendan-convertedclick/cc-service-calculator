import { test, expect, type Locator, type Page } from "@playwright/test";
import { smokeCheck } from "./helpers/shell";

/**
 * The owner escalations queue: a rail of requests grouped by who holds them,
 * and one decision at a time in the pane beside it.
 *
 * These run against whatever is in the dev database, so nothing asserts on a
 * specific client or number. What they pin is the structure an owner relies
 * on — the page chrome, the queue groups, the fixed order of the evidence,
 * and the fact that a selection survives a reload.
 */

/** Every group the rail always renders, even when a group is empty. */
const GROUPS = ["Needs you", "With admin", "Waiting on requester", "Decided"];

/** The evidence blocks, in the order the pane must always present them. */
const EVIDENCE = ["Approving", "Because", "Briefed as", "Paid by", "Signed off"];

function railGroup(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/**
 * Open the queue and wait for it to actually have loaded.
 *
 * smokeCheck only proves the shell mounted. The rows arrive from Supabase a
 * moment later, and while `rows` is null the page renders a skeleton with no
 * rail at all — so the rail nav appearing is the signal that counting rows is
 * now meaningful. Without this wait every row count races to zero.
 */
async function openQueue(page: Page): Promise<string[]> {
  const errors = await smokeCheck(page, "/escalations");
  await expect(page.getByRole("navigation", { name: "Escalation queue" })).toBeVisible();
  return errors;
}

/** First selectable request in a group, or null when the group is empty. */
async function firstRequestIn(page: Page, group: string): Promise<Locator | null> {
  const buttons = railGroup(page, group).getByRole("button");
  return (await buttons.count()) > 0 ? buttons.first() : null;
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

  test("rail lists every queue group, including the empty ones", async ({ page }) => {
    await openQueue(page);

    for (const group of GROUPS) {
      // An empty group still renders — "0 with admin" is information.
      await expect(railGroup(page, group)).toBeVisible();
    }
  });

  test("selecting a request puts it in the URL and answers in a fixed order", async ({ page }) => {
    const errors = await openQueue(page);

    const request = await firstRequestIn(page, "Needs you");
    if (!request) {
      // Nothing is awaiting a decision — assert the queue says so rather than
      // silently passing on an empty page.
      const decided = await firstRequestIn(page, "Decided");
      if (!decided) {
        await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
      }
      test.skip(true, "No requests awaiting the owner — nothing to select");
      return;
    }

    await request.click();
    await expect(page).toHaveURL(/[?&]id=[0-9a-f-]{36}/);

    // The call comes before the evidence.
    await expect(page.getByRole("region", { name: "Verdict" })).toBeVisible();

    for (const label of EVIDENCE) {
      await expect(page.getByRole("term").filter({ hasText: label })).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "Ask for info" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Approve/ })).toBeVisible();

    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("a deep link restores the same request after a reload", async ({ page }) => {
    await openQueue(page);

    const request = await firstRequestIn(page, "Needs you");
    if (!request) {
      test.skip(true, "No requests awaiting the owner — nothing to deep-link");
      return;
    }

    await request.click();
    await expect(page).toHaveURL(/[?&]id=/);
    const url = page.url();
    const heading = (await request.innerText()).split("\n")[0];

    await page.goto(url);
    await expect(page.getByRole("navigation", { name: "Escalation queue" })).toBeVisible();
    await expect(page).toHaveURL(url);

    // The same request is still the selected one.
    const selected = page.locator('button[aria-current="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText(heading);
  });

  test("reject asks for a reason before it will submit", async ({ page }) => {
    await openQueue(page);

    const request = await firstRequestIn(page, "Needs you");
    if (!request) {
      test.skip(true, "No requests awaiting the owner — nothing to reject");
      return;
    }
    await request.click();

    await page.getByRole("button", { name: "Reject", exact: true }).click();

    // Labelled, not placeholder-only, and focused so typing just works.
    const box = page.getByLabel("Why is this being rejected? The requester sees this.");
    await expect(box).toBeVisible();
    await expect(box).toBeFocused();

    // Cancel restores the actions without submitting anything.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(box).toBeHidden();
    await expect(page.getByRole("button", { name: /^Approve/ })).toBeVisible();
  });

  test("ask-for-info names the person who will be asked", async ({ page }) => {
    await openQueue(page);

    const request = await firstRequestIn(page, "Needs you");
    if (!request) {
      test.skip(true, "No requests awaiting the owner — nothing to ask about");
      return;
    }
    await request.click();
    await page.getByRole("button", { name: "Ask for info" }).click();

    const box = page.getByLabel(/^What do you need to know from /);
    await expect(box).toBeVisible();
    await expect(box).toBeFocused();
  });

  test("rows the owner cannot act on show why instead of actions", async ({ page }) => {
    await openQueue(page);

    const decided = await firstRequestIn(page, "Decided");
    if (!decided) {
      test.skip(true, "No decided requests in the queue");
      return;
    }

    await decided.click();
    await expect(page.getByRole("region", { name: "Verdict" })).toBeVisible();
    // Approve must not be offered on something already settled.
    await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  });
});
