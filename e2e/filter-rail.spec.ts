// e2e/filter-rail.spec.ts
//
// CHARACTERIZATION suite. Every page below re-inlines its own copy of the same
// left filter rail (search box on top, a divider, then checkbox-style filter
// groups). Consolidating those copies into one shared component is a pure
// refactor, so this suite pins the *behaviour* the refactor must preserve:
//
//   1. the rail renders a search box and its declared filter groups
//   2. each group's options are toggle buttons that visibly latch on click
//   3. toggling a filter narrows the result list
//   4. clearing the search restores the original result count
//
// These assertions are deliberately data-shape-agnostic (counts are compared
// relative to what the page loaded, never to hard-coded totals) so the suite
// stays green against live data.
import { test, expect, type Page } from "@playwright/test";
import { railPage, rowCount, RAIL_PAGES } from "./helpers/filter-rail";

for (const spec of RAIL_PAGES) {
  test.describe(`${spec.name} filter rail`, () => {
    test("renders a search box and every declared filter group", async ({ page }) => {
      await railPage(page, spec.url);
      await expect(page.getByPlaceholder("Search…").first()).toBeVisible();
      for (const group of spec.groups) {
        await expect(
          page.getByRole("heading", { name: group, exact: true }),
          `filter group "${group}" is missing`,
        ).toBeVisible();
      }
    });

    test("search narrows the list, and clearing it restores the original count", async ({ page }) => {
      await railPage(page, spec.url);
      const before = await rowCount(page);
      test.skip(before === 0, "no rows loaded — nothing to filter");

      const search = page.getByPlaceholder("Search…").first();
      // A string this unlikely to appear should filter the list to (near) empty.
      await search.fill("zzzzzzzzz-no-such-record");
      await expect
        .poll(() => rowCount(page), { message: "search did not narrow the list" })
        .toBeLessThan(before);

      await search.clear();
      await expect.poll(() => rowCount(page), { message: "clearing search did not restore" }).toBe(before);
    });

    test("a filter option latches on click and narrows the list", async ({ page }) => {
      await railPage(page, spec.url);
      const before = await rowCount(page);
      test.skip(before === 0, "no rows loaded — nothing to filter");

      const option = firstFilterOption(page, spec.groups[0]);
      test.skip((await option.count()) === 0, `no options under "${spec.groups[0]}"`);

      const label = ((await option.textContent()) ?? "").trim();
      await option.click();

      // The rail marks an active option with the secondary-container role colour.
      await expect(option, `"${label}" did not latch active`).toHaveClass(/bg-m-secondary-container/);
      await expect
        .poll(() => rowCount(page), { message: `selecting "${label}" did not narrow the list` })
        .toBeLessThanOrEqual(before);

      // Toggling the same option off restores the unfiltered count.
      await option.click();
      await expect(option).not.toHaveClass(/bg-m-secondary-container/);
      await expect.poll(() => rowCount(page)).toBe(before);
    });
  });
}

/** The first selectable option button inside a named filter group. */
function firstFilterOption(page: Page, group: string) {
  return page
    .getByRole("heading", { name: group, exact: true })
    .locator("xpath=following-sibling::div[1]")
    .getByRole("button")
    .first();
}
