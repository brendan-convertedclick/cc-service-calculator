import { expect, test, type Page } from "@playwright/test";
import { smokeCheck } from "./helpers/shell";

/**
 * The client's "Who's holding it up" shows the same work the staff tab does.
 *
 * THE BUG THIS PINS: the two sides read different tables. Staff read `briefs`
 * (every briefed ClickUp task), the client read only `client_approvals` (the
 * asks somebody had titled for them). A client with seven live tasks and one
 * agreement opened their page and saw one row, which reads as breakage.
 *
 * Read-only, no fixtures. It runs against the dev database, where clocks move
 * every half hour, so nothing here asserts a duration. What it pins is the ROW
 * SET — computed from the same tables the app reads, sanitised with the same
 * function — plus the two rules that make showing it safe at all:
 *
 *   1. no internal marker ("DFT V1.1", "(QC)") ever reaches the client's page
 *   2. briefed work is not decidable: it carries no Approve button
 *
 * The preview on /client-signoffs renders the real <ClientReview> tree, which
 * is why testing it here tests what the client gets. The client's own route
 * needs `client-review` redeployed for the same rows to appear there.
 */

/** A client with briefed work AND an ask, so the parity is worth measuring. */
const CLIENT = "Pimms";

type Expected = {
  titles: string[];
  work: { title: string; court: "client" | "us" }[];
  clientId: string;
};

/**
 * What the client's holding view OUGHT to list, read straight from the
 * database in the browser's own session and sanitised with the app's own
 * function. Deliberately not a hard-coded list: the point is that the two
 * sides agree about whatever is in the table today.
 */
async function expectedRows(page: Page, clientName: string): Promise<Expected> {
  return page.evaluate(async (name) => {
    const { supabase } = await import("/src/lib/supabase.ts");
    const { suggestClientTitle, UNTITLED_WORK } = await import("/src/lib/client-title.ts");

    const { data: client } = await supabase
      .from("clients")
      .select("id, name")
      .eq("name", name)
      .single();
    const clientId = client!.id as string;

    // Every open briefed task, exactly as the payload selects them.
    const { data: briefs } = await supabase
      .from("briefs")
      .select("id, raw_subject, clickup_task_status")
      .eq("client_id", clientId)
      .not("clickup_task_id", "is", null)
      .is("completed_at", null);

    // Minus the ones already drafted as an ask, or they would appear twice.
    const { data: linked } = await supabase
      .from("client_approvals")
      .select("brief_id")
      .eq("client_id", clientId)
      .not("brief_id", "is", null);
    const used = new Set((linked ?? []).map((r) => r.brief_id));

    // Plus the undecided asks themselves — questions and agreements have no
    // ClickUp task and used to be missing from this view for that reason.
    const { data: asks } = await supabase
      .from("client_approvals")
      .select("client_title, state")
      .eq("client_id", clientId)
      .eq("state", "pending");

    // The court, by the same rule courtOf uses. Spelled out rather than
    // imported so this stays a check ON the app, not a copy of it.
    const WAITING = ["waiting on client", "send to client"];
    const work = (briefs ?? [])
      .filter((b) => !used.has(b.id))
      .map((b) => ({
        title: suggestClientTitle(b.raw_subject, name) || UNTITLED_WORK,
        court: (WAITING.includes((b.clickup_task_status ?? "").toLowerCase())
          ? "client"
          : "us") as "client" | "us",
      }));

    const titles = [...work.map((w) => w.title), ...(asks ?? []).map((a) => a.client_title as string)];
    return { titles, work, clientId };
  }, clientName);
}

async function openClientHoldingView(page: Page, clientName: string) {
  const errors = await smokeCheck(page, "/client-signoffs");
  // The rail's options are aria-pressed buttons, not checkboxes — see
  // FilterOption. Their accessible name carries the count, so match on a
  // leading word rather than exactly.
  await page
    .getByRole("button", { name: new RegExp(`^${clientName}\\b`) })
    .first()
    .click();

  // The preview card renders the client's own page, and its tab bar repeats
  // the staff one's wording. The client's copy is a button; the staff tabs are
  // real ARIA tabs, so filtering by role separates them.
  await page
    .getByRole("button", { name: /Who's holding it up/i })
    .first()
    .click();
  return errors;
}

test("every open piece of work reaches the client's holding view", async ({ page }) => {
  const errors = await openClientHoldingView(page, CLIENT);
  const { titles } = await expectedRows(page, CLIENT);
  test.skip(titles.length === 0, `${CLIENT} has nothing open in the dev database right now`);

  // The ledger is folded away by default — open it, then read every row.
  await page.getByText(/Every open item, and where its time went/i).click();

  for (const title of titles) {
    await expect(
      page.getByRole("cell", { name: title, exact: true }).first(),
      `"${title}" is open for ${CLIENT} but is not on their holding view`,
    ).toBeVisible();
  }

  // The count in the summary must agree with the rows behind it.
  await expect(page.getByText(new RegExp(`\\(${titles.length}\\)`))).toBeVisible();
  expect(errors).toEqual([]);
});

test("no internal marker reaches the client's page", async ({ page }) => {
  await openClientHoldingView(page, CLIENT);
  await page.getByText(/Every open item, and where its time went/i).click();

  // raw_subject reads "… - DFT V1.1 (QC)". It is sanitised server-side and
  // must never appear, however the row got onto the page.
  await expect(page.getByText(/\bDFT\b|\bREV V\d|\(\s*QC\s*\)/i)).toHaveCount(0);
});

test("the List shows briefed work too, in the right pane and with no buttons", async ({
  page,
}) => {
  const errors = await smokeCheck(page, "/client-signoffs");
  await page
    .getByRole("button", { name: new RegExp(`^${CLIENT}\\b`) })
    .first()
    .click();

  const { work } = await expectedRows(page, CLIENT);
  test.skip(work.length === 0, `${CLIENT} has no briefed work in the dev database right now`);

  // The List is the default tab. Each pane in turn, because the whole point is
  // that a task lands where its court says and nowhere else.
  for (const pane of ["Your move", "With us"] as const) {
    const court = pane === "Your move" ? "client" : "us";
    const here = work.filter((w) => w.court === court);
    if (here.length === 0) continue;

    await page.getByRole("button", { name: new RegExp(`^${pane}`) }).first().click();
    for (const row of here) {
      await expect(
        page.getByText(row.title, { exact: true }).first(),
        `"${row.title}" is open for ${CLIENT} but is not in their ${pane} pane`,
      ).toBeVisible();
    }
  }

  // THE RULE THIS TEST EXISTS FOR. A briefed task has no client_approvals row
  // behind it, so an Approve would have nothing to record — selecting one must
  // never put a decision button on screen.
  await page.getByRole("button", { name: /^With us/ }).first().click();
  await page.getByText(work.find((w) => w.court === "us")!.title, { exact: true }).first().click();
  await expect(page.getByRole("button", { name: /^Approve$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /I've done this/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Request changes|Not yet/ })).toHaveCount(0);
  // …and no reply box either: client_activity.approval_id has nothing to point at.
  await expect(page.getByPlaceholder(/Write a reply/i)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("briefed work is shown, not made decidable", async ({ page }) => {
  await openClientHoldingView(page, CLIENT);

  // A task nobody has written an ask for cannot be approved: the holding view
  // reports time, it does not collect decisions. The buttons live on the List
  // tab, on items only.
  await expect(page.getByRole("button", { name: /^Approve$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Request changes/ })).toHaveCount(0);
});
