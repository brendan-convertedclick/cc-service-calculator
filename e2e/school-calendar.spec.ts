// e2e/school-calendar.spec.ts
//
// A school's delivery year, on the calendar the school itself looks at (0159).
//
// The claims under test are all about WHICH SQUARE a thing lands on, which is
// the whole of what a calendar asserts and the one thing a unit test on a pure
// mapping cannot prove end to end — the view's `shows_on`, the payload, the
// mapping and the grid all have to agree:
//
//   1. work we do for them is on it at all      (side 'us' rows exist on the grid)
//   2. a task with no date sits on its month end (the honest default)
//   3. the gate task does NOT                    ("unless it's an open day" —
//      six weeks before the open day, off school_task_due_on, not month end)
//   4. finished work sits on the day it FINISHED, and prefers ClickUp's own
//      closing time (briefs.completed_at) over the staff tick
//   5. an ask that already exists as a client_approvals row is on the grid
//      ONCE — the view excludes it, or every school-side ask would double
//   6. a parked item never reaches a calendar at all
//
// Both surfaces are driven, because they are two different code paths to the
// same grid: the staff preview reads the view straight from Postgres
// (useClientReviewPreview), the client's own link goes through the
// `client-review` edge function. A regression in either one is invisible from
// the other. NOTE: the client-link test exercises the DEPLOYED function — a
// green run of it is also the proof that `client-review` has been deployed
// with `schedule` on its payload.
//
// EVERYTHING IS SEEDED DIRECTLY. The seeding path (a planning session deriving
// twelve months from real open days) is pipeline.spec.ts's subject, not this
// one's; here the fixture is hand-built so every date under assertion is one
// this file chose, and the year is anchored to the month the test runs in so
// no assertion rots at a month boundary.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { waitForShell } from "./helpers/shell";
import {
  loadSystemsTestEnv,
  seedSchoolClient,
  signInBrowserAs,
  teardownPipeline,
  type SystemsFixture,
} from "./helpers/pipeline";
import { setupMember } from "./helpers/systems";

/** Distinct from E2E PIPELINE — and E2E TEST — : every suite cleans up with
 *  `like '<prefix>%'`, and under fullyParallel a shared prefix means one
 *  suite deleting another's fixtures mid-run. */
const PREFIX = "E2E CALENDAR — ";
const OWNER_EMAIL = "e2e-calendar-owner@convertedclick.co.za";
const SCHOOL = `${PREFIX}Ridgeview`;

/** The six rows the assertions are about. Prefixed so a stray one is
 *  greppable, and distinct enough that no two match the same locator. */
const GATE_TASK = `${PREFIX}Creative approved for the open day`;
const MONTH_END_TASK = `${PREFIX}Always-on search live`;
const LAST_MONTH_TASK = `${PREFIX}Audience built for the cycle`;
const DELIVERED_TASK = `${PREFIX}Open day landing page`;
const ALREADY_ASKED = `${PREFIX}Open day dates for the whole year`;
const PARKED_ITEM = `${PREFIX}Worth doing one day`;

// --- dates ----------------------------------------------------------------
// Local, string-keyed, never toISOString() — the same rule the feature runs
// on (a UTC round trip moves every SAST date before 02:00 into the previous
// square, which on a calendar is the wrong answer, not a rounding error).

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** First day of the month `offset` months from this one. */
function monthStart(offset: number): string {
  const now = new Date();
  return ymd(new Date(now.getFullYear(), now.getMonth() + offset, 1));
}

/** Last day of the month `offset` months from this one — the honest default. */
function monthEnd(offset: number): string {
  const now = new Date();
  return ymd(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0));
}

/** "YYYY-MM" for the month `offset` months from this one. */
function monthKey(offset: number): string {
  return monthStart(offset).slice(0, 7);
}

function plusDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

// M3 is this month and is the open_day_before month; its open day is the 15th
// of NEXT month, so the six-week gate lands 42 days earlier — inside this
// month, and provably not on its end.
const OPEN_DAY = `${monthKey(1)}-15`;
const GATE_ON = plusDays(OPEN_DAY, -42);
/** The day ClickUp closed the delivered task. The 12th of two months ago —
 *  deliberately nowhere near that month's end, which is where the old
 *  calendar would have drawn it (or, more accurately, not drawn it at all). */
const DELIVERED_ON = `${monthKey(-2)}-12`;

type Seed = { clientId: string; yearId: string; briefId: string; token: string };

/**
 * Three months of one school's year, hand-built:
 *   M1, two months ago     — one DELIVERED task, closed in ClickUp on the 12th
 *   M2, last month         — one planned task (no date of its own)
 *   M3, this month         — open_day_before: the gate task, a plain task,
 *                            and one school-side task that is already an ask
 * plus a parked idea, and a personal review link for the client's own page.
 */
async function seedYear(fixture: SystemsFixture): Promise<Seed> {
  const { admin } = fixture;
  const { clientId } = await seedSchoolClient(fixture, SCHOOL, "Hilton");

  // Any template will do — this suite never reads one. school_years.template_id
  // is NOT NULL with an `on delete restrict` FK, so it has to be a real row.
  const { data: settings } = await admin
    .from("settings")
    .select("default_pipeline_template_id")
    .maybeSingle();
  let templateId = settings?.default_pipeline_template_id ?? null;
  if (!templateId) {
    const { data: anyTemplate } = await admin
      .from("pipeline_templates")
      .select("id")
      .limit(1)
      .maybeSingle();
    templateId = anyTemplate?.id ?? null;
  }
  if (!templateId) throw new Error("school-calendar e2e: no pipeline_templates row to hang a year off");

  const { data: year, error: yearErr } = await admin
    .from("school_years")
    .insert({
      client_id: clientId,
      template_id: templateId,
      started_on: monthStart(-2),
      open_days: [OPEN_DAY],
    })
    .select("id")
    .single();
  if (yearErr || !year) throw new Error(`school-calendar e2e: year: ${yearErr?.message}`);

  const { error: monthsErr } = await admin.from("school_year_months").insert([
    { year_id: year.id, month_no: 1, theme: "Set the year up", role: "spine", starts_on: monthStart(-2) },
    { year_id: year.id, month_no: 2, theme: "Steady state", role: "filler", starts_on: monthStart(-1) },
    // The role is what school_task_due_on reads for the gate — never the theme
    // text, which is renameable.
    { year_id: year.id, month_no: 3, theme: "Build the open day machine", role: "open_day_before", starts_on: monthStart(0) },
  ]);
  if (monthsErr) throw new Error(`school-calendar e2e: months: ${monthsErr.message}`);

  // The ClickUp side of a delivered task. `completed_at` is what
  // sync-clickup-actuals writes from date_done/date_closed, and what the view
  // prefers over the staff tick.
  const { data: brief, error: briefErr } = await admin
    .from("briefs")
    .insert({
      client_id: clientId,
      source: "manual",
      raw_body: `${PREFIX}fixture brief`,
      completed_at: `${DELIVERED_ON}T09:15:00+02:00`,
    })
    .select("id")
    .single();
  if (briefErr || !brief) throw new Error(`school-calendar e2e: brief: ${briefErr?.message}`);

  const { data: tasks, error: tasksErr } = await admin
    .from("school_tasks")
    .insert([
      {
        // done_at is deliberately a DIFFERENT day from the brief's
        // completed_at: the assertion is that ClickUp's date wins, and two
        // equal dates would prove nothing.
        year_id: year.id, month_no: 1, label: DELIVERED_TASK, side: "us",
        state: "done", due_date: monthEnd(-2), done_at: `${monthEnd(-2)}T12:00:00+02:00`,
        brief_id: brief.id, ordinal: 1, is_gate: false,
      },
      // EVERY NOT-NULL COLUMN IS SPELLED OUT ON EVERY ROW. A PostgREST bulk
      // insert takes the UNION of the keys across the array and sends NULL for
      // the ones a given row omits — it does not fall back to the column
      // default — so an omitted `state` or `is_gate` here is a not-null
      // violation, not a default.
      { year_id: year.id, month_no: 2, label: LAST_MONTH_TASK, side: "us", ordinal: 1, is_gate: false, state: "planned" },
      { year_id: year.id, month_no: 3, label: MONTH_END_TASK, side: "us", ordinal: 1, is_gate: false, state: "planned" },
      { year_id: year.id, month_no: 3, label: GATE_TASK, side: "school", is_gate: true, ordinal: 2, state: "planned" },
      { year_id: year.id, month_no: 3, label: ALREADY_ASKED, side: "school", ordinal: 3, is_gate: false, state: "planned" },
    ])
    .select("id, label");
  if (tasksErr || !tasks) throw new Error(`school-calendar e2e: tasks: ${tasksErr?.message}`);

  const askedTaskId = tasks.find((t) => t.label === ALREADY_ASKED)!.id;

  // The ask this school-side task already became, exactly as
  // schedule_school_year_month mints it. The view must leave the task off, or
  // the client sees the same sentence twice on the same square.
  const { data: approval, error: approvalErr } = await admin
    .from("client_approvals")
    .insert({
      client_id: clientId,
      item_type: "brief",
      item_id: askedTaskId,
      client_title: ALREADY_ASKED,
      ask: "We need this from you.",
      due_date: monthEnd(0),
      owed_by: "client",
      raised_by: "us",
      state: "pending",
    })
    .select("id")
    .single();
  if (approvalErr || !approval) throw new Error(`school-calendar e2e: ask: ${approvalErr?.message}`);

  const { error: linkErr } = await admin
    .from("school_tasks")
    .update({ client_approval_id: approval.id })
    .eq("id", askedTaskId);
  if (linkErr) throw new Error(`school-calendar e2e: ask link: ${linkErr.message}`);

  // Parked, dated, and therefore the one row that would show up if the
  // mapping ever stopped dropping it. An idea is always parked (0148), which
  // makes it the cheapest legal parked row to build.
  const { error: parkedErr } = await admin.from("client_approvals").insert({
    client_id: clientId,
    item_type: "idea",
    client_title: PARKED_ITEM,
    ask: "Not now.",
    due_date: monthEnd(0),
    owed_by: "client",
    raised_by: "us",
    state: "parked",
  });
  if (parkedErr) throw new Error(`school-calendar e2e: parked: ${parkedErr.message}`);

  // A personal link for the client's own page. Only the sha256 hex is stored,
  // so the plaintext exists here and nowhere else — same as the real thing.
  const token = randomUUID().replace(/-/g, "");
  const { error: tokenErr } = await admin.from("client_review_tokens").insert({
    client_id: clientId,
    token_hash: createHash("sha256").update(token).digest("hex"),
  });
  if (tokenErr) throw new Error(`school-calendar e2e: token: ${tokenErr.message}`);

  return { clientId, yearId: year.id, briefId: brief.id, token };
}

/** briefs.client_id is ON DELETE NO ACTION, so the fixture brief has to go
 *  before the client can. school_tasks.brief_id is ON DELETE SET NULL, and
 *  that write is legal here because this suite closes no month. */
async function teardown(fixture: SystemsFixture): Promise<void> {
  await fixture.admin.from("briefs").delete().like("raw_body", `${PREFIX}%`);
  await teardownPipeline(fixture, PREFIX);
}

// --- page objects ---------------------------------------------------------

/**
 * Does the DEPLOYED client-review carry `schedule` yet?
 *
 * The client's own page is served by the deployed function, not by anything in
 * this checkout, so a green local suite can sit alongside a live portal that
 * has never heard of the school's plan. Rather than assert into that gap and
 * leave a permanently red test — the failure mode CLAUDE.md records for the
 * old CI, where a suite nobody could get green stopped being read — this asks
 * the function directly and the test skips itself with the reason. It un-skips
 * the moment the function is deployed; nothing here needs editing then.
 */
async function schedulePayloadIsDeployed(
  env: { url: string; anonKey: string },
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${env.url}/functions/v1/client-review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({ action: "list", token }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string; schedule?: unknown };
    return body.status === "ok" && Array.isArray(body.schedule);
  } catch {
    return false;
  }
}

/** One square of the grid. The whole point of the suite: an assertion about a
 *  calendar that cannot name the day is not an assertion. */
function day(page: Page, date: string): Locator {
  return page.getByTestId(`day-${date}`);
}

/** Chips carrying exactly this title, and only the ones ON the grid — the
 *  staff page renders the same client's items in a table underneath, and a
 *  count that includes those proves nothing about the calendar. */
function chips(page: Page, title: string): Locator {
  return page.locator(`[data-testid^="day-"] [title="${title}"]`);
}

/** The month the grid is currently showing, as its own heading renders it —
 *  the only reliable "have we arrived" signal, because the grid pads with the
 *  neighbouring months' days and a date cell alone can belong to either. */
function monthHeading(offset: number): RegExp {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const name = first.toLocaleDateString("en-ZA", { month: "long" });
  return new RegExp(`^${name}\\s+${first.getFullYear()}$`);
}

/** The month-view toggle, on either surface. `role: button` and not `tab`
 *  distinguishes it from /client-signoffs' own Calendar TAB, which is a
 *  different (staff) grid. */
async function openCalendar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  // It opens on this month, which is where the first block of assertions is.
  await expect(page.getByRole("heading", { name: monthHeading(0) })).toBeVisible();
}

/** One press of the back arrow, landing on the month named. Absolute rather
 *  than relative: a helper that clicks `offset` times reads the same at every
 *  call site and means something different depending on where the grid was. */
async function stepBackTo(page: Page, offset: number): Promise<void> {
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { name: monthHeading(offset) })).toBeVisible();
}

/** Every assertion this suite makes about a rendered month, run against
 *  whichever surface is passed in. Two surfaces, one set of claims — if they
 *  ever disagree, one of them is lying to somebody. */
async function assertTheYearReads(page: Page): Promise<void> {
  await test.step("this month: the plan is on it, and the gate is not on the month end", async () => {
    // 1 — our own work reaches the client's calendar at all.
    await expect(day(page, monthEnd(0))).toContainText(MONTH_END_TASK);

    // 3 — the gate is six weeks before the open day, not the month end.
    await expect(day(page, GATE_ON)).toContainText(GATE_TASK);
    await expect(day(page, monthEnd(0))).not.toContainText(GATE_TASK);

    // 5 — the ask exists once, from the items, not twice via the plan.
    await expect(chips(page, ALREADY_ASKED)).toHaveCount(1);

    // 6 — parked is on nobody's clock, so it is on no calendar.
    await expect(page.locator('[data-testid^="day-"]', { hasText: PARKED_ITEM })).toHaveCount(0);
  });

  await test.step("last month: a task with no date of its own sits on the month end", async () => {
    await stepBackTo(page, -1);
    await expect(day(page, monthEnd(-1))).toContainText(LAST_MONTH_TASK);
  });

  await test.step("two months back: delivered work sits on the day ClickUp closed it", async () => {
    await stepBackTo(page, -2);
    // 4 — ClickUp's date, not the staff tick and not the due date.
    await expect(day(page, DELIVERED_ON)).toContainText(DELIVERED_TASK);
    await expect(day(page, monthEnd(-2))).not.toContainText(DELIVERED_TASK);
    // and it reads as done rather than as a deadline that has gone by
    await expect(chips(page, `${DELIVERED_TASK} — done`)).toHaveCount(1);
  });
}

test.describe("A school's year on the client calendar", () => {
  // One fixture year, two surfaces reading it. Serial for the same reason
  // pipeline.spec.ts is: beforeAll builds state both tests read.
  test.describe.configure({ mode: "serial" });

  const env = loadSystemsTestEnv();
  let fixture: SystemsFixture | null = null;
  let seed: Seed | null = null;

  test.beforeAll(async () => {
    if (!env) return; // both tests below skip themselves with a clear reason
    fixture = await setupMember(env, "owner", OWNER_EMAIL);
    seed = await seedYear(fixture);
  });

  test.afterAll(async () => {
    if (!fixture) return;
    await teardown(fixture);
  });

  test("staff preview: the plan, the gate and what was delivered", async ({ page }) => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");

    await signInBrowserAs(page, OWNER_EMAIL, fixture!.password);
    await page.goto("/client-signoffs");
    await waitForShell(page);

    // The rail lists every client that has ever been asked for anything; ours
    // has one ask, so it is there.
    await page.getByRole("button", { name: new RegExp(SCHOOL) }).first().click();
    await expect(page.getByText(`What ${SCHOOL} sees`)).toBeVisible();

    await openCalendar(page);
    await assertTheYearReads(page);
  });

  test("the client's own link opens their own month view", async ({ page }) => {
    test.skip(!env || !seed, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");

    // Asked BEFORE the page is opened, so the reason is known whichever way
    // this goes — see schedulePayloadIsDeployed.
    const deployed = await schedulePayloadIsDeployed(env!, seed!.token);

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`/review/${seed!.token}`);
    // This page has no AppShell — it is the client's, and waitForShell would
    // wait for a rail that must never render on it.
    await expect(page.getByText(SCHOOL).first()).toBeVisible({ timeout: 20_000 });

    await openCalendar(page);

    // Unconditional: the link works, the month view opens, and what they were
    // asked for is on the square it is due. True with or without the plan.
    await expect(day(page, monthEnd(0))).toContainText(ALREADY_ASKED);

    if (deployed) {
      // The whole year, asserted exactly as it is on the staff preview — two
      // code paths to one grid, one set of claims.
      await assertTheYearReads(page);
    } else {
      // Said out loud, not just annotated: an annotation lands in the HTML
      // report and nowhere else, and a green tick whose reason lives somewhere
      // nobody opens is precisely how this repo's old CI came to verify
      // nothing. The warning prints in every reporter.
      const why =
        "SCHOOL CALENDAR E2E: the deployed client-review has no `schedule` on its list payload, " +
        "so the plan assertions did NOT run on the client's own link. Deploy it (--no-verify-jwt) and they will.";
      console.warn(why);
      test.info().annotations.push({ type: "not verified", description: why });
    }

    expect(errors, "unexpected JS errors on the client's page").toHaveLength(0);
  });
});
