import { expect, type Page } from "@playwright/test";
import { waitForShell } from "./shell";

/**
 * The pages that each carry their own inlined copy of the left filter rail
 * (search box, divider, then filter groups). `groups` are the group headings
 * rendered in that page's rail; `rows` locates one element per result row so a
 * filter's effect can be measured without hard-coding data volumes.
 */
export const RAIL_PAGES: { name: string; url: string; groups: string[] }[] = [
  { name: "Briefs", url: "/briefs", groups: ["Client", "Billing"] },
  { name: "Projects", url: "/projects", groups: ["Client", "Status"] },
  { name: "Retainers", url: "/retainers", groups: ["Client", "Status"] },
  { name: "Services", url: "/services", groups: ["Group", "Rule", "Status"] },
];

/**
 * One element per result row. A CSS selector rather than `getByRole("row")`:
 * these tables carry Tailwind display utilities that drop native table
 * semantics from the accessibility tree, so the ARIA row role matches nothing.
 */
const ROWS = "tbody tr";

/**
 * Navigates to a rail page and waits until its data has actually landed.
 *
 * `networkidle` alone is not enough: the filter groups are rendered only once
 * their options are non-empty, so a spec that starts asserting too early sees
 * a rail with no groups and zero rows. Waiting for the first declared group
 * heading is the reliable signal that the page's query resolved.
 */
export async function railPage(page: Page, url: string): Promise<void> {
  const spec = RAIL_PAGES.find((s) => s.url === url);
  if (!spec) throw new Error(`railPage: ${url} is not a known rail page`);

  await page.goto(url);
  await waitForShell(page);
  await expect(page.getByPlaceholder("Search…").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: spec.groups[0], exact: true }),
    `${spec.name}: filter group "${spec.groups[0]}" never appeared — data did not load`,
  ).toBeVisible({ timeout: 20_000 });

  // The rail renders before the result table paints. Wait for the first row so
  // the "before" count is the loaded count. Tolerates a genuinely empty page —
  // the specs skip themselves when there is nothing to filter.
  await page
    .locator(ROWS)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});
}

/** Current number of result rows on whichever rail page is loaded. */
export async function rowCount(page: Page): Promise<number> {
  return page.locator(ROWS).count();
}
