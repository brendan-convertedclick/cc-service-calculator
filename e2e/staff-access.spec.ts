// e2e/staff-access.spec.ts
//
// Company-wide access: a staff-role user gets the app shell (so they can
// navigate), the Systems library read-only, and a profile they can edit —
// and nothing else. Everything asserted here has two halves that must agree:
// the UI (what the nav shows, which buttons render) and RLS (what the API
// actually permits). A test that only clicked the UI would pass against a
// database that lets staff rewrite anyone's role.
//
// Runs against the live database with a throwaway staff member created in
// beforeAll and deleted in afterAll (same fixture machinery as systems.spec).
import { test, expect } from "@playwright/test";
import { waitForShell } from "./helpers/shell";
import {
  E2E_STAFF_EMAIL,
  E2E_STAFF_PREFIX,
  loadSystemsTestEnv,
  setupMember,
  signInBrowserAs,
  teardownOwner,
  type SystemsFixture,
} from "./helpers/systems";

test.describe("Staff access", () => {
  // Serial: every test signs the one browser context into the same throwaway
  // account, and the profile test mutates the row the others read.
  test.describe.configure({ mode: "serial" });

  const env = loadSystemsTestEnv();
  let fixture: SystemsFixture | null = null;
  let systemId: string | undefined;

  test.beforeAll(async () => {
    if (!env) return; // every test below skips itself with a clear reason
    fixture = await setupMember(env, "staff", E2E_STAFF_EMAIL);
    // A system to read. Created service-role: staff must not be able to make
    // one, which is exactly what the RLS test below asserts.
    const { data, error } = await fixture.admin
      .from("system_definitions")
      .insert({
        name: `${E2E_STAFF_PREFIX}Staff-readable procedure`,
        kind: "reference",
        goal_statement: "Something a staff member should be able to read.",
      })
      .select("id")
      .single();
    if (error) throw new Error(`staff-access setup: could not seed a system: ${error.message}`);
    systemId = data.id;
  });

  test.afterAll(async () => {
    if (!fixture) return;
    await teardownOwner(fixture, E2E_STAFF_PREFIX);
  });

  test("the nav rail shows staff only what they can open", async ({ page }) => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");
    await signInBrowserAs(page, E2E_STAFF_EMAIL, fixture!.password);

    // Expand the rail so labels (not just icons) are in the accessibility tree.
    await page.getByRole("button", { name: "Open navigation" }).click();

    // Scoped to the rail: breadcrumbs are links too, and they follow the route
    // rather than the role.
    const rail = page.locator("aside");
    for (const label of ["My work", "Systems", "Profile"]) {
      await expect(
        rail.getByRole("link", { name: label, exact: true }),
        `staff should see "${label}"`,
      ).toBeVisible();
    }
    for (const label of ["Dashboard", "Inbox", "Clients", "Team", "Settings", "Escalations"]) {
      await expect(
        rail.getByRole("link", { name: label, exact: true }),
        `staff should not see "${label}"`,
      ).toHaveCount(0);
    }
  });

  test("an admin-only route bounces staff back to their own surface", async ({ page }) => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");
    await signInBrowserAs(page, E2E_STAFF_EMAIL, fixture!.password);

    await page.goto("/clients");
    await waitForShell(page);
    await expect(page).toHaveURL(/\/staff$/);
    // Landing there means the shell, not the old bare page: the rail is how
    // they get anywhere else.
    await expect(page.getByRole("tab", { name: "New brief" })).toBeVisible();
  });

  test("Systems is readable but not editable", async ({ page }) => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");
    await signInBrowserAs(page, E2E_STAFF_EMAIL, fixture!.password);

    await page.goto("/systems");
    await waitForShell(page);
    await expect(page.getByRole("heading", { name: "Systems", level: 1 })).toBeVisible();
    await expect(page.getByText(`${E2E_STAFF_PREFIX}Staff-readable procedure`)).toBeVisible();
    await expect(page.getByRole("button", { name: /^New / })).toHaveCount(0);

    await page.goto(`/systems/${systemId}`);
    await waitForShell(page);
    await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
    // The system's own fields render, disabled — reading them is the point.
    await expect(page.getByRole("textbox", { name: "Procedure name" })).toBeDisabled();
  });

  test("profile: staff can edit their own details, and sign out", async ({ page }) => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");
    await signInBrowserAs(page, E2E_STAFF_EMAIL, fixture!.password);

    await page.goto("/profile");
    await waitForShell(page);

    const newName = `${E2E_STAFF_PREFIX}Renamed Staff`;
    const nameField = page.getByLabel("Full name");
    await expect(nameField).toBeEnabled();
    await nameField.fill(newName);
    await nameField.blur(); // saves on blur
    await expect(page.getByText("Profile updated")).toBeVisible();

    // Landed in the database, not just in React state.
    const { data: row } = await fixture!.admin
      .from("team_members")
      .select("full_name, role")
      .eq("id", fixture!.memberId)
      .single();
    expect(row?.full_name).toBe(newName);
    expect(row?.role, "editing a profile must not touch the role").toBe("staff");

    // Email and access level are an admin's to change, not theirs.
    await expect(page.getByLabel("Email")).toBeDisabled();

    // The page's own button, not the rail's — both are legitimate exits.
    await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
    // Asserted without reloading on purpose: a reload re-runs the local-dev
    // auto-login (AuthContext's DEV_AUTO_LOGIN) and would sign the browser
    // straight back in as team@, failing this for the wrong reason.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /sign in/i }).first()).toBeVisible();
  });

  test("RLS: a staff session cannot write what the UI doesn't offer", async () => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");
    const { owner: staff, admin, memberId } = fixture!;

    await test.step("cannot create a system", async () => {
      const { error } = await staff.from("system_definitions").insert({
        name: `${E2E_STAFF_PREFIX}staff should never create this`,
        kind: "reference",
        goal_statement: "nope",
      });
      expect(error?.code, "expected an RLS violation").toBe("42501");
    });

    await test.step("cannot edit a procedure's steps", async () => {
      const { error } = await staff.from("process_steps").insert({
        system_id: systemId,
        title: `${E2E_STAFF_PREFIX}staff should never add this step`,
        ordinal: 1,
      });
      expect(error?.code, "expected an RLS violation").toBe("42501");
    });

    await test.step("cannot promote themselves", async () => {
      // No error: the BEFORE UPDATE trigger (migration 0115) restores the
      // privileged columns rather than rejecting the statement, so the proof
      // is the row afterwards, not the response.
      await staff.from("team_members").update({ role: "owner", cost_rate_cents: 1 }).eq("id", memberId);
      const { data } = await admin
        .from("team_members")
        .select("role, cost_rate_cents")
        .eq("id", memberId)
        .single();
      expect(data?.role).toBe("staff");
      expect(data?.cost_rate_cents).toBeNull();
    });

    await test.step("cannot edit someone else's row", async () => {
      const { data: other } = await admin
        .from("team_members")
        .select("id, full_name")
        .neq("id", memberId)
        .is("archived_at", null)
        .limit(1)
        .single();
      test.skip(!other, "no other team member to attempt this against");

      // RLS filters the row out of the UPDATE's scope entirely — no error, no
      // rows returned, and the name is untouched.
      const { data: updated } = await staff
        .from("team_members")
        .update({ full_name: `${E2E_STAFF_PREFIX}hijacked` })
        .eq("id", other!.id)
        .select();
      expect(updated ?? []).toHaveLength(0);

      const { data: after } = await admin
        .from("team_members")
        .select("full_name")
        .eq("id", other!.id)
        .single();
      expect(after?.full_name).toBe(other!.full_name);
    });
  });
});
