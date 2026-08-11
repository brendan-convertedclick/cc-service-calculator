// e2e/helpers/systems.ts
//
// Systems e2e needs real admin/owner DB permission, which the app's default
// local-dev session (auto-login as team@convertedclick.co.za) does NOT have:
// system_definitions/system_revisions/system_edges RLS (and the
// publish_system_revision RPC's own role check) gate writes on
// current_team_member_role() in ('admin','owner'), resolved from a
// team_members row — and team@ has none (see CLAUDE.md). So this suite
// creates its own throwaway admin/owner team member + Supabase Auth user for
// the duration of the run, and cleans both up afterwards.
//
// Everything here runs in Node (the Playwright test body), not the browser —
// @supabase/supabase-js is a plain npm dependency, not path-aliased, so it
// resolves fine under Playwright's own TS loader (see helpers/sow.ts's note
// on why "@/" imports are avoided in e2e/).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { waitForShell } from "./shell";

/** Every row this suite creates carries this prefix on its identifying text
 * column — the cleanup proof at the end of systems.spec.ts greps for it. */
export const E2E_PREFIX = "E2E TEST — ";

export const E2E_OWNER_EMAIL = "e2e-systems-owner@convertedclick.co.za";
export const E2E_STAFF_EMAIL = "e2e-systems-staff@convertedclick.co.za";
/** staff-access.spec's own prefix. Deliberately NOT a suffix of E2E_PREFIX:
 * both suites clean up with `like '<prefix>%'`, and under fullyParallel the
 * first to finish would otherwise delete the other's fixtures mid-run. */
export const E2E_STAFF_PREFIX = "E2E STAFF — ";

function readEnvFile(p: string): Record<string, string> {
  return fs.existsSync(p) ? dotenv.parse(fs.readFileSync(p)) : {};
}

export type SystemsTestEnv = { url: string; anonKey: string; serviceKey: string };

/**
 * `.env.local` (present in every checkout) has the app's URL/anon key. The
 * service-role key needed to create/delete a throwaway auth user only lives
 * in mcp-server/.env — gitignored, and never copied into worktrees. Read
 * (never write) it rather than duplicating a secret. Both candidate paths are
 * tried so this works from the main checkout and from a worktree three levels
 * down under .claude/worktrees/. Returns null if nothing is found anywhere;
 * callers should skip rather than fabricate a substitute.
 */
const MCP_ENV_CANDIDATES = [
  ["mcp-server", ".env"],                     // main checkout
  ["..", "..", "..", "mcp-server", ".env"],   // .claude/worktrees/<branch>/
];

export function loadSystemsTestEnv(): SystemsTestEnv | null {
  const local = readEnvFile(path.resolve(process.cwd(), ".env.local"));
  const mcpEnv = MCP_ENV_CANDIDATES.reduce<Record<string, string>>(
    (found, parts) =>
      found.SUPABASE_SERVICE_ROLE_KEY
        ? found
        : readEnvFile(path.resolve(process.cwd(), ...parts)),
    {},
  );

  const url = process.env.SUPABASE_URL || local.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || local.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || mcpEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) return null;
  return { url, anonKey, serviceKey };
}

export type SystemsFixture = {
  /** Service-role client — bypasses RLS. Setup/teardown only, never for
   * exercising the feature (a service-role call can't even pass
   * publish_system_revision's own role check — see that function's comment
   * on auth.uid() being null outside a real user JWT). */
  admin: SupabaseClient;
  /** Anon-key client signed in as the throwaway owner — a real user JWT,
   * exactly like the app itself would hold. Every RLS-gated assertion in
   * systems.spec.ts goes through this client. */
  owner: SupabaseClient;
  authUserId: string;
  password: string;
  /** The throwaway member's team_members.id — staff-access.spec needs it to
   * assert profile writes landed (and that privileged ones didn't). */
  memberId: string;
  email: string;
  role: MemberRole;
};

export type MemberRole = "staff" | "admin" | "owner";

/** Creates a throwaway team member + auth user at `role` for this run.
 * Self-healing: deletes any same-email leftovers from a previous crashed run
 * first, so repeated runs never accumulate stray users. */
export async function setupMember(
  env: SystemsTestEnv,
  role: MemberRole = "owner",
  email: string = E2E_OWNER_EMAIL,
): Promise<SystemsFixture> {
  const admin = createClient(env.url, env.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const stale = existing?.users.find((u) => u.email === email);
  if (stale) await admin.auth.admin.deleteUser(stale.id);
  await admin.from("team_members").delete().eq("email", email);

  const password = `E2E-${randomUUID()}`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`e2e setup: could not create ${role} auth user: ${createErr?.message}`);
  }

  const { data: member, error: memberErr } = await admin
    .from("team_members")
    .insert({
      full_name: `${E2E_PREFIX}${role[0].toUpperCase()}${role.slice(1)}`,
      email,
      role,
      auth_user_id: created.user.id,
    })
    .select("id")
    .single();
  if (memberErr || !member) {
    throw new Error(`e2e setup: could not create ${role} team_members row: ${memberErr?.message}`);
  }

  const user = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInErr } = await user.auth.signInWithPassword({ email, password });
  if (signInErr) {
    throw new Error(`e2e setup: could not sign in as ${role}: ${signInErr.message}`);
  }

  return { admin, owner: user, authUserId: created.user.id, password, memberId: member.id, email, role };
}

/** systems.spec's original entry point — an owner fixture. */
export function setupOwner(env: SystemsTestEnv): Promise<SystemsFixture> {
  return setupMember(env, "owner", E2E_OWNER_EMAIL);
}

/** Deletes everything this run created, by prefix rather than by tracked id
 * — so a mid-test crash that never reaches the `let systemId = ...`
 * assignment still gets cleaned up. Cascades handle the rest: deleting
 * system_definitions cascades to process_steps.system_id, system_revisions
 * and system_edges (all `on delete cascade`); current_revision_id is
 * `on delete set null`. */
export async function teardownOwner(
  fixture: SystemsFixture,
  namePrefix: string = E2E_PREFIX,
): Promise<void> {
  await fixture.admin.from("system_definitions").delete().like("name", `${namePrefix}%`);
  // By email, not by name prefix: two suites can hold fixtures at once, and
  // wiping every prefixed row would delete the other one's member mid-run.
  await fixture.admin.from("team_members").delete().eq("email", fixture.email);
  await fixture.admin.auth.admin.deleteUser(fixture.authUserId);
}

/**
 * Replaces the browser's local-dev auto-login session (team@, owner-in-the-UI
 * only, no team_members row) with a real signed-in session for the throwaway
 * member created by setupMember — so RLS-gated writes clicked through the UI
 * (New system, Propose, Approve) actually succeed instead of 42501-ing.
 *
 * Ordering matters: AuthContext kicks off its own auto sign-in as team@ on
 * mount, racing this call. We wait for *some* session to exist first (proof
 * the auto-login's own signInWithPassword already resolved) before calling
 * ours, so there is no in-flight auto-login promise left that could resolve
 * after ours and clobber it. The reload then re-mounts the whole app reading
 * the now-persisted owner session from a cold start — DEV_AUTO_LOGIN only
 * fires when `getSession()` comes back empty, so it's skipped entirely and
 * every navigation after this point just uses the owner session, no race
 * window left to reopen.
 */
export async function signInBrowserAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await waitForShell(page);

  await page.waitForFunction(async () => {
    const mod = await import("/src/lib/supabase.ts");
    const { data } = await mod.supabase.auth.getSession();
    return !!data.session;
  });

  const signInError = await page.evaluate(
    async ({ email, password }) => {
      const mod = await import("/src/lib/supabase.ts");
      const { error } = await mod.supabase.auth.signInWithPassword({ email, password });
      return error?.message ?? null;
    },
    { email, password }
  );
  if (signInError) throw new Error(`browser sign-in as ${email} failed: ${signInError}`);

  await page.reload();
  await waitForShell(page);
}
