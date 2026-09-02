// e2e/pipeline.spec.ts
//
// Pipeline: a school's whole delivery year, end to end — a planning session
// derives twelve months from two REAL open-day dates (D1: the dialog's Q2 is
// now a list of native date rows, not month chips — a chip degraded every
// open day to the 1st of its month, which made the six-week rule fire on
// 100% of schools regardless of the real gap), a task moves between future
// months on the CLICK-TO-PICK path (drag-and-drop against native
// dataTransfer is flaky under Playwright, and click-to-move is the primary,
// accessible mechanism anyway — same call the build plan makes), a closed
// month refuses a move at both the DB trigger and the planner's own
// affordance, and closing M1 through the drawer's confirm dialog advances
// the school to M2 with real dates. A second test then covers the three
// remaining fixed defects that need the year already mapped: D4 (the shared
// team@ login can close a month), D5 (adding a service into the CURRENT
// month lands as a tickable, scheduled task, not a dead 'planned' one that
// blocks the month forever) and D7a (a month emptied by moving everything
// forward is just as closeable as a fully-ticked one).
//
// One fixture client, "E2E PIPELINE — Oakhill", is_school=true from the
// start (so it lands directly in the board's "Not started" column — no need
// to drive AddSchoolDialog). Everything downstream (the year, its months,
// its tasks, the client_approvals it mints) hangs off that one client and is
// deleted by cascade in afterAll — see helpers/pipeline.ts.
//
// TWO OPEN DAYS, CHOSEN DELIBERATELY: 2026-03-20 (lands in M3) and
// 2026-06-05 (lands in M6) of a year started 2026-01-01 — same month
// assignment the old month-chip fixture used (March/June), so every
// "M{n} · {theme}" assertion below is unchanged. What changed is the DAY:
// M2 (open_day_before for M3's open day) runs 2026-02-01 → 2026-03-20, 47
// days — comfortably clear of the six-week (42-day) minimum, so it shows NO
// breach. M5 (open_day_before for M6's open day) runs 2026-05-01 →
// 2026-06-05, 35 days — inside six weeks, so it DOES breach. One of each is
// the point: a month-chip fixture could only ever produce the second kind
// (D1's own bug), so asserting both is what proves the rule now carries
// information instead of firing unconditionally.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { smokeCheck, waitForShell } from "./helpers/shell";
import {
  E2E_PIPELINE_PREFIX,
  E2E_PIPELINE_OWNER_EMAIL,
  loadSystemsTestEnv,
  seedSchoolClient,
  setupPipelineOwner,
  signInBrowserAs,
  teardownPipeline,
  type SystemsFixture,
} from "./helpers/pipeline";

const SCHOOL_NAME = `${E2E_PIPELINE_PREFIX}Oakhill`;
const DRAWER_TITLE = `${SCHOOL_NAME} — school year`; // SchoolDrawer's sr-only SheetTitle

/** The school's card on the board, scoped from its own name — Pipeline.tsx
 *  renders the same name string in the "Not started" shape and the full
 *  shape, so this is only ever resolved once the right one is on screen. */
function schoolCard(page: Page): Locator {
  return page
    .getByText(SCHOOL_NAME, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')]");
}

/** One month's PlannerColumn, scoped from its own "M{n}" header — every
 *  task/hours/"Move here" query for that month is chained off this, because
 *  at least one theme (here, "Build the open day machine") seeds two months
 *  and an unscoped query would be ambiguous between them. */
function column(page: Page, monthNo: number): Locator {
  return page
    .getByText(`M${monthNo}`, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'shrink-0') and contains(@class,'rounded-lg')]");
}

/** D1: Q2 of PlanningSessionDialog is a variable-length list of native date
 *  rows, each with its own "Remove this open day" button right after the
 *  input — so the newest row is always that button's preceding sibling,
 *  regardless of how many rows (or how many OTHER date inputs elsewhere in
 *  the dialog) already exist. */
async function addOpenDayRow(dialog: Locator, date: string): Promise<void> {
  await dialog.getByRole("button", { name: "Add an open day" }).click();
  const removeButtons = dialog.getByRole("button", { name: "Remove this open day" });
  await removeButtons.last().locator("xpath=preceding-sibling::input[@type='date']").fill(date);
}

test.describe("Pipeline", () => {
  // The journey test creates a year and drives it through several state
  // transitions the later smoke test depends on (a yearId to visit) — one
  // worker, declaration order, same reasoning as systems.spec.ts.
  test.describe.configure({ mode: "serial" });

  const env = loadSystemsTestEnv();
  let fixture: SystemsFixture | null = null;
  let yearId: string | undefined;

  test.beforeAll(async () => {
    if (!env) return; // every gated test below skips itself with a clear reason
    fixture = await setupPipelineOwner(env);
    await seedSchoolClient(fixture, SCHOOL_NAME, "Knysna");
  });

  test.afterAll(async () => {
    if (!fixture) return;
    await teardownPipeline(fixture);
  });

  test("smoke: /pipeline renders without a crash", async ({ page }) => {
    const errors = await smokeCheck(page, "/pipeline");
    await expect(page.getByRole("heading", { name: "Pipeline", level: 1 })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("journey: plan a year → move a task → a closed month refuses → tick + close M1 → M2", async ({
    page,
  }) => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");
    const { owner } = fixture!;

    await signInBrowserAs(page, E2E_PIPELINE_OWNER_EMAIL, fixture!.password);

    await test.step("the school starts in Not started — run its planning session", async () => {
      await page.goto("/pipeline");
      await waitForShell(page);
      await expect(page.getByText(SCHOOL_NAME, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Run planning session" }).click();
    });

    await test.step("five questions, two REAL open days → the live preview derives all twelve months and breaches only where the gap is actually under six weeks", async () => {
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      // Year starts FIRST — the derivation below is computed off it, so
      // filling it after the open-day rows would leave stale dates.
      await dialog.locator("#ps-started").fill("2026-01-01");

      // Q1 (applications open/close) has no accessible name of its own, so
      // it's filled by position while the only date inputs in the dialog are
      // ps-started + these two — before Q2 grows the input count.
      const dateInputs = dialog.locator('input[type="date"]');
      await dateInputs.nth(1).fill("2026-01-10"); // applications open
      await dateInputs.nth(2).fill("2026-02-10"); // applications close

      // Q2 — D1: real dates, one row per open day, not month chips.
      await addOpenDayRow(dialog, "2026-03-20");
      await addOpenDayRow(dialog, "2026-06-05");

      // Q3 (offers/deposits) is always the last two date inputs in the
      // dialog, however many open-day rows Q2 now holds.
      const total = await dateInputs.count();
      await dateInputs.nth(total - 2).fill("2026-08-01"); // offers out
      await dateInputs.nth(total - 1).fill("2026-08-15"); // deposits due
      await dialog.locator("#ps-budget").fill("2026-07");
      await dialog.locator("#ps-grades").fill("Grade 000–R apply on a rolling basis.");

      await expect(dialog.getByText("M1 · Set the year up", { exact: true })).toBeVisible();
      await expect(dialog.getByText("M2 · Build the open day machine", { exact: true })).toBeVisible();
      await expect(dialog.getByText("M3 · Open day runs", { exact: true })).toBeVisible();
      await expect(dialog.getByText("M4 · Convert the interest", { exact: true })).toBeVisible();
      await expect(dialog.getByText("M5 · Build the open day machine", { exact: true })).toBeVisible();
      await expect(dialog.getByText("M6 · Open day runs", { exact: true })).toBeVisible();
      await expect(dialog.getByText("M7 · Convert the interest", { exact: true })).toBeVisible();
      await expect(dialog.getByText("M8 · Offers go out", { exact: true })).toBeVisible();

      // D1's whole point: a real date carries real information. M2 → M3's
      // open day is 47 days out (clear of the six-week minimum) and must
      // stay silent; M5 → M6's open day is 35 days out (inside it) and must
      // be the ONLY breach line shown — not both, the way a month-chip
      // fixture always forced.
      const warningLines = dialog.locator("p.text-m-on-error-container");
      await expect(warningLines).toHaveCount(1);
      await expect(
        dialog.getByText(
          "M5's open day (2026-06-05) leaves only 35 day(s) of run-up — under the six-week minimum.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(dialog.getByText(/M2's open day/)).toHaveCount(0);

      // Mapping the year opens the drawer on the new year — screen 1's own
      // view (see Pipeline.tsx's onSaved). The PLAN button that crosses into
      // screen 2, the granular planner, lives on the card, once it has a
      // year — not in the dialog and not in the drawer itself.
      await dialog.getByRole("button", { name: "Map the year" }).click();
      const newDrawer = page.getByRole("dialog", { name: DRAWER_TITLE });
      await expect(newDrawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(newDrawer).toBeHidden();

      await schoolCard(page).getByRole("link", { name: "PLAN", exact: true }).click();
      await page.waitForURL(/\/pipeline\/[0-9a-f-]{36}$/);
      yearId = page.url().split("/").pop();
    });

    expect(yearId, "planning session produced a year").toBeTruthy();

    await test.step("M1 arrived at creation: its tasks are scheduled with due dates, and its school-side tasks minted client_approvals", async () => {
      await expect(page.getByText("Set the year up", { exact: true })).toBeVisible();

      const { data: m1Tasks, error } = await owner
        .from("school_tasks")
        .select("id, label, side, state, due_date, client_approval_id")
        .eq("year_id", yearId!)
        .eq("month_no", 1)
        .order("ordinal");
      expect(error).toBeNull();
      expect(m1Tasks).toHaveLength(8); // "Set the year up": 5 us + 3 school, verbatim from the decks
      for (const t of m1Tasks!) {
        expect(t.state, `${t.label} should be scheduled`).toBe("scheduled");
        expect(t.due_date, `${t.label} should carry a due date`).not.toBeNull();
      }

      const schoolTasks = m1Tasks!.filter((t) => t.side === "school");
      expect(schoolTasks).toHaveLength(3);
      for (const t of schoolTasks) expect(t.client_approval_id, `${t.label} minted an ask`).not.toBeNull();

      const { data: approvals, error: apprErr } = await owner
        .from("client_approvals")
        .select("id, item_type, item_id, owed_by, state")
        .in(
          "id",
          schoolTasks.map((t) => t.client_approval_id as string),
        );
      expect(apprErr).toBeNull();
      expect(approvals).toHaveLength(3);
      const taskIds = new Set(schoolTasks.map((t) => t.id));
      for (const a of approvals!) {
        expect(a.item_type).toBe("brief");
        expect(a.owed_by).toBe("client");
        expect(taskIds.has(a.item_id as string)).toBe(true);
      }
    });

    await test.step("D2: move a task via click-to-pick — it lands, carries 'from M5', and both months' hours totals move by exactly its own seeded hours", async () => {
      // 0151 seeded real est_hours on every template task (D2) — nothing to
      // write here. Read the two column totals as numbers first, so the
      // assertion below is "the delta equals this task's own hours" rather
      // than a literal string pinned to today's seed table.
      const m5Before = parseFloat((await column(page, 5).locator("p.font-mono").innerText()) ?? "0");
      const m9Before = parseFloat((await column(page, 9).locator("p.font-mono").innerText()) ?? "0");

      await column(page, 5)
        .getByRole("button", { name: "Landing page built and tested", exact: true })
        .click(); // pick up

      // useMoveTask's commit() announces "Moved to month 9." optimistically,
      // the instant the client-side cache is patched — the real PATCH is
      // still in flight. Every check below the announcement, up to and
      // including the DB read, only holds once that round trip has actually
      // landed, so wait for it explicitly rather than for its optimistic
      // echo (a query direct from `owner`, a second connection, has no
      // reason to have caught up with the app's own network request yet).
      const patched = page.waitForResponse(
        (r) => r.url().includes("/rest/v1/school_tasks") && r.request().method() === "PATCH",
      );
      await column(page, 9).getByRole("button", { name: "Move here", exact: true }).click(); // commit
      await patched;
      await expect(page.getByRole("status")).toHaveText("Moved to month 9.");

      const moved = column(page, 9).getByRole("button", {
        name: "Landing page built and tested, moved from month 5",
        exact: true,
      });
      await expect(moved).toBeVisible();
      await expect(moved.getByText("from M5", { exact: true })).toBeVisible();
      await expect(column(page, 5).getByText("Landing page built and tested")).toHaveCount(0);

      // D2: the whole point — moving a task visibly changes both months'
      // hours totals by exactly its own seeded hours, not by nothing (every
      // total used to read "0.00 hr" no matter what moved, because
      // est_hours was null on all 66 template tasks).
      const { data: movedTask, error: hoursErr } = await owner
        .from("school_tasks")
        .select("est_hours")
        .eq("year_id", yearId!)
        .eq("home_month_no", 5)
        .eq("label", "Landing page built and tested")
        .single();
      expect(hoursErr).toBeNull();
      const taskHours = Number(movedTask!.est_hours);
      expect(taskHours, "D2: the template must seed a real, nonzero hour value").toBeGreaterThan(0);

      await expect(column(page, 5).locator("p.font-mono")).toHaveText(`${(m5Before - taskHours).toFixed(2)} hr`);
      await expect(column(page, 9).locator("p.font-mono")).toHaveText(`${(m9Before + taskHours).toFixed(2)} hr`);

      // "Landing page built and tested" is seeded into BOTH M2 and M5 — the
      // theme "Build the open day machine" is used twice this year — so this
      // disambiguates on home_month_no (stable across the move) rather than
      // label alone, or .single() below would 406 on two matching rows.
      const { data: task, error } = await owner
        .from("school_tasks")
        .select("month_no, home_month_no, state, due_date, moved_at, moved_by")
        .eq("year_id", yearId!)
        .eq("home_month_no", 5)
        .eq("label", "Landing page built and tested")
        .single();
      expect(error).toBeNull();
      expect(task).toMatchObject({ month_no: 9, home_month_no: 5, state: "planned", due_date: null });
      expect(task!.moved_at).not.toBeNull();
      expect(task!.moved_by).toBe(fixture!.memberId);
    });

    await test.step("a closed month refuses a move — the trigger and the planner's own affordance agree", async () => {
      // A regular authenticated write can never set closed_at at all
      // (school_year_months_update's own `with check (closed_at is null)`),
      // so the service-role client is the only way to fabricate a closed M1
      // ahead of the real close-month flow (exercised for real, below).
      const { error: fabricateErr } = await fixture!.admin
        .from("school_year_months")
        .update({ closed_at: new Date().toISOString(), closed_by: fixture!.memberId })
        .eq("year_id", yearId!)
        .eq("month_no", 1);
      expect(fabricateErr).toBeNull();

      // Same disambiguation as above — this is M5's twin, now sitting in M9.
      const { data: target, error: findErr } = await owner
        .from("school_tasks")
        .select("id")
        .eq("year_id", yearId!)
        .eq("home_month_no", 5)
        .eq("label", "Landing page built and tested")
        .single();
      expect(findErr).toBeNull();

      const { error: guardErr } = await owner.from("school_tasks").update({ month_no: 1 }).eq("id", target!.id);
      expect(guardErr).not.toBeNull();
      expect(guardErr!.message).toContain("closed — work cannot be scheduled into it");

      await page.reload();
      await waitForShell(page);
      await column(page, 9)
        .getByRole("button", { name: "Landing page built and tested, moved from month 5", exact: true })
        .click(); // pick up
      const blocked = column(page, 1).getByRole("button", {
        name: "Month 1 is closed — work cannot be scheduled into it.",
        exact: true,
      });
      await expect(blocked).toBeVisible();
      await expect(blocked).toBeDisabled();
      await page.keyboard.press("Escape"); // cancel the pick-up before continuing

      const { error: restoreErr } = await fixture!.admin
        .from("school_year_months")
        .update({ closed_at: null, closed_by: null })
        .eq("year_id", yearId!)
        .eq("month_no", 1);
      expect(restoreErr).toBeNull();
      await page.reload();
      await waitForShell(page);
    });

    await test.step("tick every 'us' task in M1, settle the school's asks, close the month — M2 arrives", async () => {
      await page.goto("/pipeline");
      await waitForShell(page);
      await page.getByText(SCHOOL_NAME, { exact: true }).click(); // opens the drawer on M1 (the school's current month)

      const drawer = page.getByRole("dialog", { name: DRAWER_TITLE });
      await expect(drawer).toBeVisible();

      const usLabels = [
        "Ultimate guides refreshed",
        "School calendar published",
        "SEO health check, and fix what it finds",
        "Always-on search live",
        "Tracking verified with a live submission",
      ];
      for (const label of usLabels) {
        const box = drawer.getByRole("checkbox", { name: label, exact: true });
        await box.click();
        await expect(box).toBeChecked();
      }

      // The school's three asks settle exactly like a client deciding on
      // their own portal would — Delta C's trigger, not a click in this
      // drawer, is what should flip the linked tasks to done.
      const { data: schoolTasks, error: findErr } = await owner
        .from("school_tasks")
        .select("id, client_approval_id")
        .eq("year_id", yearId!)
        .eq("month_no", 1)
        .eq("side", "school");
      expect(findErr).toBeNull();
      expect(schoolTasks).toHaveLength(3);
      for (const t of schoolTasks!) {
        const { error } = await owner
          .from("client_approvals")
          .update({ state: "approved", decided_at: new Date().toISOString() })
          .eq("id", t.client_approval_id!);
        expect(error).toBeNull();
      }
      const { data: settled, error: settledErr } = await owner
        .from("school_tasks")
        .select("state")
        .in(
          "id",
          schoolTasks!.map((t) => t.id),
        );
      expect(settledErr).toBeNull();
      expect(settled!.every((t) => t.state === "done")).toBe(true);

      await page.reload(); // the approvals settle was a raw DB write
      await waitForShell(page);
      await page.getByText(SCHOOL_NAME, { exact: true }).click();
      const drawer2 = page.getByRole("dialog", { name: DRAWER_TITLE });
      await expect(drawer2.getByText("Everything in M1 is done.", { exact: true })).toBeVisible();

      await drawer2.getByRole("button", { name: "Close M1", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: /Close M1/ });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Close M1", exact: true }).click();
      await expect(page.getByText("M1 closed — M2 is now scheduled.", { exact: true })).toBeVisible();

      const { data: monthRows, error: monthErr } = await owner
        .from("school_year_months")
        .select("month_no, closed_at")
        .eq("year_id", yearId!)
        .in("month_no", [1, 2]);
      expect(monthErr).toBeNull();
      expect(monthRows!.find((m) => m.month_no === 1)!.closed_at).not.toBeNull();
      expect(monthRows!.find((m) => m.month_no === 2)!.closed_at).toBeNull();

      const { data: m2Tasks, error: m2Err } = await owner
        .from("school_tasks")
        .select("state, due_date")
        .eq("year_id", yearId!)
        .eq("month_no", 2);
      expect(m2Err).toBeNull();
      expect(m2Tasks).toHaveLength(7); // "Build the open day machine": 5 us + 2 school
      for (const t of m2Tasks!) {
        expect(t.state).toBe("scheduled");
        expect(t.due_date).not.toBeNull();
      }

      await page.goto("/pipeline");
      await waitForShell(page);
      await expect(page.getByText("M2 · Build the open day machine", { exact: true })).toBeVisible();
    });
  });

  test("defects: team@ can close a month (D4), adding a service into the current month is tickable (D5), and an emptied month still closes (D7a)", async ({
    page,
  }) => {
    test.skip(!env || !fixture || !yearId, "journey test did not produce a year to test against");
    const { owner } = fixture!;

    // Deliberately NO signInBrowserAs call — this is the point of D4: a
    // fresh page with no persisted session auto-logs in as the shared
    // team@convertedclick.co.za login (AuthContext's DEV_AUTO_LOGIN), the
    // one CLAUDE.md says the team actually signs in as, and which resolves
    // to a null current_team_member_id() with no team_members row.
    const { data: curRow, error: curErr } = await owner
      .from("school_year_months")
      .select("month_no")
      .eq("year_id", yearId!)
      .is("closed_at", null)
      .order("month_no")
      .limit(1)
      .single();
    expect(curErr).toBeNull();
    const currentMonth = curRow!.month_no; // M2 — the journey test closed M1

    await test.step("D5: adding a service into the CURRENT month lands scheduled with a date, not a dead 'planned' row", async () => {
      await page.goto(`/pipeline/${yearId}`);
      await waitForShell(page);

      await column(page, currentMonth).getByRole("button", { name: "Add a service" }).click();
      await page.getByPlaceholder("Search services…").fill("Social Media Post");
      await page.getByRole("option", { name: "Social Media Post" }).click(); // not exact — CommandItem's leading Check icon has no aria-hidden

      // One of its top-level process_steps, so the popover's write actually
      // landed on the board before the DB assertion below runs.
      await expect(column(page, currentMonth).getByText("Excel & Content", { exact: true })).toBeVisible();

      const { data: added, error } = await owner
        .from("school_tasks")
        .select("id, label, state, due_date")
        .eq("year_id", yearId!)
        .eq("month_no", currentMonth)
        .eq("source", "service");
      expect(error).toBeNull();
      expect(added!.length).toBeGreaterThan(0);
      for (const t of added!) {
        // Pre-0151: useAddServiceToMonth always inserted state:'planned',
        // due_date:null — untickable (school_tasks_planned_chk) and
        // permanently "not done" to close_school_year_month. The INSERT
        // branch of tg_school_tasks_guard must have promoted it on write.
        expect(t.state, `${t.label} should have arrived scheduled, not planned`).toBe("scheduled");
        expect(t.due_date, `${t.label} should carry a real due date`).not.toBeNull();
      }
    });

    await test.step("D4: team@ ticks the month, settles the school's asks, and closes it — closed_at lands, closed_by lands null", async () => {
      const { data: usTasks, error: usErr } = await owner
        .from("school_tasks")
        .select("id, label")
        .eq("year_id", yearId!)
        .eq("month_no", currentMonth)
        .eq("side", "us")
        .neq("state", "done");
      expect(usErr).toBeNull();

      const { data: schoolTasks, error: schErr } = await owner
        .from("school_tasks")
        .select("id, client_approval_id")
        .eq("year_id", yearId!)
        .eq("month_no", currentMonth)
        .eq("side", "school");
      expect(schErr).toBeNull();

      await page.goto("/pipeline");
      await waitForShell(page);
      await page.getByText(SCHOOL_NAME, { exact: true }).click(); // opens on the school's current month
      const drawer = page.getByRole("dialog", { name: DRAWER_TITLE });
      await expect(drawer).toBeVisible();

      for (const t of usTasks!) {
        const box = drawer.getByRole("checkbox", { name: t.label, exact: true });
        await box.click();
        await expect(box).toBeChecked();
      }

      for (const t of schoolTasks!) {
        if (!t.client_approval_id) continue;
        const { error } = await owner
          .from("client_approvals")
          .update({ state: "approved", decided_at: new Date().toISOString() })
          .eq("id", t.client_approval_id);
        expect(error).toBeNull();
      }

      await page.reload(); // the approvals settle was a raw DB write
      await waitForShell(page);
      await page.getByText(SCHOOL_NAME, { exact: true }).click();
      const drawer2 = page.getByRole("dialog", { name: DRAWER_TITLE });
      await expect(drawer2.getByText(`Everything in M${currentMonth} is done.`, { exact: true })).toBeVisible();

      await drawer2.getByRole("button", { name: `Close M${currentMonth}`, exact: true }).click();
      const confirm = page.getByRole("dialog", { name: new RegExp(`Close M${currentMonth}`) });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: `Close M${currentMonth}`, exact: true }).click();
      await expect(
        page.getByText(`M${currentMonth} closed — M${currentMonth + 1} is now scheduled.`, { exact: true }),
      ).toBeVisible();

      const { data: monthRow, error: monthErr } = await owner
        .from("school_year_months")
        .select("closed_at, closed_by")
        .eq("year_id", yearId!)
        .eq("month_no", currentMonth)
        .single();
      expect(monthErr).toBeNull();
      // Pre-0151: this INSERT violated school_year_months_closed_chk outright
      // ("closed_at is null) = (closed_by is null)" — closed_at not null with
      // closed_by null failed the constraint, so team@ could never close a
      // month at all.
      expect(monthRow!.closed_at, "D4: a close with no attributable closer must not be refused").not.toBeNull();
      expect(monthRow!.closed_by, "team@ has no team_members row — closed_by must land null").toBeNull();
    });

    await test.step("D7a: the new current month, emptied by moving every task forward, still shows a working Close button", async () => {
      const nextMonth = currentMonth + 1; // now current, after D4's close above
      const targetMonth = nextMonth < 12 ? 12 : nextMonth - 1; // "forward" — whichever end of the year is free

      const { data: nextTasks, error: nextErr } = await owner
        .from("school_tasks")
        .select("id, state")
        .eq("year_id", yearId!)
        .eq("month_no", nextMonth);
      expect(nextErr).toBeNull();
      expect(nextTasks!.length).toBeGreaterThan(0);

      for (const t of nextTasks!) {
        if (t.state === "done") continue; // tg_school_tasks_guard refuses to move done work
        const { error } = await owner.from("school_tasks").update({ month_no: targetMonth }).eq("id", t.id);
        expect(error).toBeNull();
      }

      await page.goto("/pipeline");
      await waitForShell(page);
      await page.getByText(SCHOOL_NAME, { exact: true }).click(); // opens on the (now-empty) current month
      const drawer = page.getByRole("dialog", { name: DRAWER_TITLE });
      await expect(drawer).toBeVisible();

      // Pre-fix: readyToClose was gated on progress.total > 0, so an empty
      // month — exactly what close_school_year_month's own error message
      // recommends doing ("move them forward") — could never show this at all.
      await expect(drawer.getByText(`Nothing left in M${nextMonth}.`, { exact: true })).toBeVisible();

      await drawer.getByRole("button", { name: `Close M${nextMonth}`, exact: true }).click();
      const confirm = page.getByRole("dialog", { name: new RegExp(`Close M${nextMonth}`) });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: `Close M${nextMonth}`, exact: true }).click();
      await expect(
        page.getByText(`M${nextMonth} closed — M${nextMonth + 1} is now scheduled.`, { exact: true }),
      ).toBeVisible();

      const { data: monthRow, error: monthErr } = await owner
        .from("school_year_months")
        .select("closed_at")
        .eq("year_id", yearId!)
        .eq("month_no", nextMonth)
        .single();
      expect(monthErr).toBeNull();
      expect(monthRow!.closed_at, "D7a: an emptied (total===0) month must still be closeable").not.toBeNull();
    });
  });

  test("smoke: /pipeline/:yearId renders without a crash", async ({ page }) => {
    test.skip(!yearId, "journey test did not produce a year to test against");
    // Default (team@) session — every 0150 table is read-open to
    // authenticated, and team@ resolves to owner anyway (see CLAUDE.md), so
    // no fixture sign-in is needed just to render the planner.
    const errors = await smokeCheck(page, `/pipeline/${yearId}`);
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });
});
