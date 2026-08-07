// e2e/systems.spec.ts
//
// Systems (Phases 4-6): a goal-bearing system → steps → propose → approve →
// rev 2 published, rev 1 superseded. The Phase 5 acceptance scenario is the
// spine of the "lifecycle" test below.
//
// Every RLS-gated write (system_definitions/system_revisions/system_edges,
// and the publish_system_revision RPC) requires an admin/owner
// team_members row — the app's default local-dev session (team@…, see
// CLAUDE.md) has none, so this suite creates its own throwaway owner via
// helpers/systems.ts and signs the *browser* into it wherever the UI is
// driven directly. Steps have no "add step" affordance outside the canvas's
// drag-and-drop surface, so they're seeded DB-direct — per the task, that's
// exactly the "UI doesn't support it" case.
//
// Everything created here is prefixed E2E_PREFIX and deleted in afterAll,
// by prefix rather than by tracked id, so a crash mid-test still cleans up.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { smokeCheck, waitForShell } from "./helpers/shell";
import {
  E2E_OWNER_EMAIL,
  E2E_PREFIX,
  loadSystemsTestEnv,
  setupOwner,
  signInBrowserAsOwner,
  teardownOwner,
  type SystemsFixture,
} from "./helpers/systems";

test.describe("Systems", () => {
  // The lifecycle test creates state (systemId, revisions) that later tests
  // in this file depend on — force one worker, declaration order, so that
  // sharing plain module-scope variables across `test()` calls is safe.
  test.describe.configure({ mode: "serial" });

  const env = loadSystemsTestEnv();
  let fixture: SystemsFixture | null = null;
  let systemId: string | undefined;

  test.beforeAll(async () => {
    if (!env) return; // every gated test below skips itself with a clear reason
    fixture = await setupOwner(env);
  });

  test.afterAll(async () => {
    if (!fixture) return;
    await teardownOwner(fixture);
  });

  test("smoke: /systems list renders without a crash", async ({ page }) => {
    const errors = await smokeCheck(page, "/systems");
    await expect(page.getByRole("heading", { name: "Systems", level: 1 })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });

  test("lifecycle: create with a goal → steps attach → propose → publish rev 1 → change + propose + publish rev 2 (rev 1 superseded)", async ({
    page,
  }) => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");
    const { owner } = fixture!;
    const systemName = `${E2E_PREFIX}Systems lifecycle`;

    await test.step("a system cannot be created without a goal — enforced at the DB, not just the dialog", async () => {
      const { error } = await owner.from("system_definitions").insert({
        name: `${E2E_PREFIX}should never exist (no goal)`,
        kind: "reference",
        // goal_statement omitted on purpose
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23502"); // not-null violation
    });

    await signInBrowserAsOwner(page, E2E_OWNER_EMAIL, fixture!.password);

    await test.step("New system dialog blocks a missing goal client-side, then creates one with a goal", async () => {
      await page.goto("/systems");
      await waitForShell(page);
      await page.getByRole("button", { name: "New system" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Name").fill(systemName);
      // 'reference' has no linked-record requirement — dodges
      // system_definitions_one_per_{service,recurring,internal}_idx entirely.
      await dialog.getByLabel("Kind").selectOption("reference");

      await dialog.getByRole("button", { name: "Create" }).click();
      await expect(page.getByText(/Goal is required/i)).toBeVisible();
      await expect(page).toHaveURL(/\/systems$/); // blocked client-side — never navigated

      await dialog.getByLabel("Goal statement").fill("E2E lifecycle probe — not a real system");
      await dialog.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/systems\/[0-9a-f-]{36}$/);
      systemId = page.url().split("/").pop();

      await expect(page.getByLabel("System name")).toHaveValue(systemName);
    });

    expect(systemId, "system was created").toBeTruthy();

    await test.step("steps attach to the system (DB-direct — no 'add step' UI exists outside canvas drag)", async () => {
      const { error: e1 } = await owner.from("process_steps").insert({
        system_id: systemId,
        ordinal: 1,
        title: `${E2E_PREFIX}Step one`,
        estimated_hours: 2,
      });
      expect(e1).toBeNull();
      const { error: e2 } = await owner.from("process_steps").insert({
        system_id: systemId,
        ordinal: 2,
        title: `${E2E_PREFIX}Step two`,
        estimated_hours: 3,
      });
      expect(e2).toBeNull();

      await page.reload();
      await waitForShell(page);
      await expect(page.getByText(`${E2E_PREFIX}Step one`)).toBeVisible();
      await expect(page.getByText(`${E2E_PREFIX}Step two`)).toBeVisible();
    });

    await test.step("proposing a change requires a reason — disabled in the dialog, rejected by the DB", async () => {
      const { error } = await owner.from("system_revisions").insert({
        system_id: systemId,
        revision: 999, // sentinel, never persists — keeps the real 1/2 sequence clean
        body: [],
        state: "proposed",
        // reason_for_change omitted
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23502");

      await page.getByRole("button", { name: "Propose changes" }).click();
      const proposeDialog = page.getByRole("dialog");
      await expect(proposeDialog).toBeVisible();
      await expect(proposeDialog.getByRole("button", { name: "Propose", exact: true })).toBeDisabled();
    });

    await test.step("propose rev 1 through the UI", async () => {
      const proposeDialog = page.getByRole("dialog");
      await proposeDialog.getByLabel("Reason for change").fill(`${E2E_PREFIX}initial process definition`);
      await proposeDialog.getByRole("button", { name: "Propose", exact: true }).click();
      await expect(page.getByText("Revision proposed")).toBeVisible();
      await expect(page.getByText("Rev 1", { exact: true })).toBeVisible();
      await expect(page.getByText("Proposed", { exact: true })).toBeVisible();
    });

    await test.step("publish_system_revision rejects a caller with no admin/owner team_members row", async () => {
      // The one invariant in this feature that lives in application code, not
      // a DB constraint — worth guarding directly, not just via the RPC's
      // happy path below. An anonymous (unauthenticated) client's auth.uid()
      // is null inside the function, same as team@'s would-be caller having
      // no team_members row: current_team_member_role() resolves null either
      // way, so this exercises the exact guard team@ would hit.
      const { data: rev1 } = await owner
        .from("system_revisions")
        .select("id")
        .eq("system_id", systemId)
        .eq("revision", 1)
        .single();

      const anon = createClient(env!.url, env!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await anon.rpc("publish_system_revision", { p_revision_id: rev1!.id });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("admin or owner role required");

      // Guard didn't publish it — still proposed.
      const { data: stillProposed } = await owner
        .from("system_revisions")
        .select("state")
        .eq("id", rev1!.id)
        .single();
      expect(stillProposed?.state).toBe("proposed");
    });

    await test.step("approve rev 1 through the UI", async () => {
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByText("Revision published")).toBeVisible();
      await expect(page.getByText("Published", { exact: true })).toBeVisible();
    });

    await test.step("change a step, propose rev 2 through the UI, approve it — rev 1 supersedes", async () => {
      const { data: step1 } = await owner
        .from("process_steps")
        .select("id")
        .eq("system_id", systemId)
        .eq("ordinal", 1)
        .single();
      const { error: updateErr } = await owner
        .from("process_steps")
        .update({ estimated_hours: 5 })
        .eq("id", step1!.id);
      expect(updateErr).toBeNull();

      await page.getByRole("button", { name: "Propose changes" }).click();
      const proposeDialog = page.getByRole("dialog");
      await proposeDialog.getByLabel("Reason for change").fill(`${E2E_PREFIX}bumped step one's estimate`);
      await proposeDialog.getByRole("button", { name: "Propose", exact: true }).click();
      await expect(page.getByText("Revision proposed")).toBeVisible();
      await expect(page.getByText("Rev 2", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByText("Revision published")).toBeVisible();
      await expect(page.getByText("Superseded", { exact: true })).toBeVisible(); // rev 1, now superseded
    });

    await test.step("DB confirms: rev 2 published, rev 1 superseded, current_revision_id points at rev 2", async () => {
      const { data: revs, error } = await owner
        .from("system_revisions")
        .select("id, revision, state")
        .eq("system_id", systemId)
        .order("revision");
      expect(error).toBeNull();
      expect(revs).toHaveLength(2);
      expect(revs![0]).toMatchObject({ revision: 1, state: "superseded" });
      expect(revs![1]).toMatchObject({ revision: 2, state: "published" });

      const { data: sys } = await owner
        .from("system_definitions")
        .select("current_revision_id")
        .eq("id", systemId)
        .single();
      expect(sys?.current_revision_id).toBe(revs![1].id);
    });
  });

  test("one-live invariant: a second published revision is rejected (23505)", async () => {
    test.skip(!env || !fixture, "no SUPABASE_SERVICE_ROLE_KEY available — see loadSystemsTestEnv");
    test.skip(!systemId, "lifecycle test did not produce a system to test against");
    const { owner } = fixture!;

    // Direct insert, not publish_system_revision — the RPC supersedes the
    // prior published row *first*, so it can never trip this index. This
    // proves the constraint itself holds even if that ordering ever changed.
    const { error } = await owner.from("system_revisions").insert({
      system_id: systemId,
      revision: 3,
      body: [],
      state: "published", // rev 2 is already the one live row for this system
      reason_for_change: `${E2E_PREFIX}invariant probe — must fail`,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });

  test("canvas: /systems/:id mounts the drag-and-drop canvas without a crash", async ({ page }) => {
    test.skip(!systemId, "lifecycle test did not produce a system to test against");

    // Default (team@) session — reading is authenticated-open on every
    // systems table, no owner elevation needed here.
    const errors = await smokeCheck(page, `/systems/${systemId}`);
    await expect(page.getByRole("button", { name: "Tidy up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Propose", exact: true })).toBeVisible();
    expect(errors, "unexpected JS errors").toHaveLength(0);
  });
});
