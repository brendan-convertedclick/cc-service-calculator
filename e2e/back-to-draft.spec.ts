// e2e/back-to-draft.spec.ts
//
// Anything can come back to Draft, and any role can bring it (0147).
//
// The point of this suite is the role, so it drives the button as a real
// STAFF member — not the owner, and not the local-dev team@ session which
// resolves to owner in the UI and would prove nothing. What it pins:
//
//   - a staff member can un-approve a live procedure
//   - the sign-off dates clear and the approver rows survive
//   - the system stops pointing at a current revision
//   - a replaced revision is refused
//
// WRITES TO THE LIVE DATABASE, like systems.spec.ts. Everything is prefixed
// and deleted in afterAll by prefix rather than by tracked id, so a crash
// mid-test still cleans up.
import { expect, test } from "@playwright/test";
import { waitForShell } from "./helpers/shell";
import {
  E2E_STAFF_EMAIL,
  loadSystemsTestEnv,
  setupMember,
  signInBrowserAs,
  teardownOwner,
  type SystemsFixture,
} from "./helpers/systems";

const PREFIX = "E2E BACKDRAFT — ";

test.describe("Back to draft", () => {
  test.describe.configure({ mode: "serial" });

  const env = loadSystemsTestEnv();
  let owner: SystemsFixture | null = null;
  let staff: SystemsFixture | null = null;
  let systemId = "";
  let revisionId = "";

  test.beforeAll(async () => {
    if (!env) return; // every test below skips itself with a clear reason
    // Two actors: the owner exists only to get something into the Approved
    // state, because publishing is still admin/owner-only. The staff member
    // is the one under test.
    owner = await setupMember(env, "owner", "e2e-backdraft-owner@convertedclick.co.za");
    staff = await setupMember(env, "staff", E2E_STAFF_EMAIL);

    // Errors are surfaced, never swallowed: a null here would leave every
    // assertion below passing against a system that does not exist.
    const { data: system, error: sysErr } = await owner.admin
      .from("system_definitions")
      .insert({
        name: `${PREFIX}Procedure`,
        kind: "reference",
        goal_statement: `${PREFIX}so this suite has something to un-approve`,
      })
      .select("id")
      .single();
    if (sysErr || !system) throw new Error(`e2e setup: system insert failed: ${sysErr?.message}`);
    systemId = (system as { id: string }).id;

    const { data: rev, error: revErr } = await owner.admin
      .from("system_revisions")
      .insert({
        system_id: systemId,
        revision: 1,
        state: "proposed",
        reason_for_change: `${PREFIX}first submission`,
        body: [],
        proposed_by: owner.memberId,
        proposed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (revErr || !rev) throw new Error(`e2e setup: revision insert failed: ${revErr?.message}`);
    revisionId = (rev as { id: string }).id;

    // A signed-off required approver, so publish_system_revision's own guards
    // are satisfied — and so there is a stamp for the reopen to clear.
    await owner.admin.from("system_revision_approvals").insert({
      revision_id: revisionId,
      team_member_id: owner.memberId,
      required: true,
      approved_at: new Date().toISOString(),
    });

    // Through the RPC as a real owner JWT, exactly as the app publishes.
    const { error } = await owner.owner.rpc("publish_system_revision", {
      p_revision_id: revisionId,
    });
    if (error) throw new Error(`e2e setup: could not publish: ${error.message}`);
  });

  test.afterAll(async () => {
    if (owner) await teardownOwner(owner, PREFIX);
    if (staff) await teardownOwner(staff, PREFIX);
  });

  test("a staff member un-approves a live procedure from the revision card", async ({ page }) => {
    test.skip(!env || !staff, "systems e2e env not configured");

    await signInBrowserAs(page, staff!.email, staff!.password);
    await page.goto(`/systems/${systemId}`);
    await waitForShell(page);

    // The revision cards live on their own pane; the other panes render them
    // into a hidden div, so everything below has to be driven from here.
    await page.getByRole("button", { name: /^Revisions/ }).click();

    // It starts approved. If this ever reads Draft the setup silently failed
    // and everything below would pass for the wrong reason.
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Back to draft" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The published wording, not the generic one — this is the case that
    // costs something and the copy has to say so.
    await expect(dialog.getByText(/nothing approved/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Un-approve and edit" }).click();

    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

    // What the badge cannot show. Read back through the service role because
    // the assertion is about rows, not about what this user may see.
    const { data: rev } = await staff!.admin
      .from("system_revisions")
      .select("state, approved_at, approved_by")
      .eq("id", revisionId)
      .single();
    expect(rev).toMatchObject({ state: "draft", approved_at: null, approved_by: null });

    const { data: sys } = await staff!.admin
      .from("system_definitions")
      .select("current_revision_id")
      .eq("id", systemId)
      .single();
    expect((sys as { current_revision_id: string | null }).current_revision_id).toBeNull();

    // Carry the people, never the approved_at: the row stays, the stamp goes.
    const { data: approvals } = await staff!.admin
      .from("system_revision_approvals")
      .select("id, approved_at")
      .eq("revision_id", revisionId);
    expect(approvals).toHaveLength(1);
    expect(approvals![0].approved_at).toBeNull();
  });

  test("a replaced revision is refused — history does not reopen", async () => {
    test.skip(!env || !staff, "systems e2e env not configured");

    await staff!.admin.from("system_revisions").update({ state: "superseded" }).eq("id", revisionId);
    const { error } = await staff!.owner.rpc("system_revision_back_to_draft", {
      p_revision_id: revisionId,
    });
    expect(error?.message).toContain("has been replaced");

    const { data: rev } = await staff!.admin
      .from("system_revisions")
      .select("state")
      .eq("id", revisionId)
      .single();
    expect((rev as { state: string }).state).toBe("superseded");
  });
});
