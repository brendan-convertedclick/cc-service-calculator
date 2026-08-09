import { expect, type Locator, type Page } from "@playwright/test";
import { waitForShell } from "./shell";

/**
 * The pages that each carry their own inlined copy of the left filter rail
 * (search box, divider, then filter groups). `groups` are the group headings
 * rendered in that page's rail; `rows` locates one element per result row so a
 * filter's effect can be measured without hard-coding data volumes.
 */
export const RAIL_PAGES: {
  name: string;
  url: string;
  groups: string[];
  rows: (page: Page) => Locator;
}[] = [
  { name: "Briefs", url: "/briefs", groups: ["Client", "Billing"], rows: (p) => p.getByRole("row") },
  { name: "Projects", url: "/projects", groups: ["Client", "Status"], rows: (p) => p.getByRole("row") },
  { name: "Retainers", url: "/retainers", groups: ["Client", "Status"], rows: (p) => p.getByRole("row") },
  {
    name: "Services",
    url: "/services",
    groups: ["Group", "Rule", "Status"],
    rows: (p) => p.getByRole("link", { name: /detail/i }),
  },
];

/** Navigates to a rail page and waits for the shell plus its search box. */
export async function railPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForShell(page);
  await expect(page.getByPlaceholder("Search…").first()).toBeVisible();
  // Rows stream in from Supabase; give the first paint a moment to settle so
  // the "before" count is the loaded count, not zero.
  await page.waitForLoadState("networkidle");
}

/** Current number of result rows on whichever rail page is loaded. */
export async function rowCount(page: Page): Promise<number> {
  const spec = RAIL_PAGES.find((s) => page.url().includes(s.url));
  if (!spec) throw new Error(`rowCount: ${page.url()} is not a known rail page`);
  return spec.rows(page).count();
}
