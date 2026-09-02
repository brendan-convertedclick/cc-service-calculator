// e2e/helpers/pipeline.ts
//
// Pipeline e2e fixture setup/teardown. The RLS on every 0150 table is wide
// open to `authenticated` (school_years/school_tasks: "a school's own year
// is everybody's to run"), so — unlike systems.spec.ts — this suite does not
// strictly need an admin/owner team_members row to exercise the feature.
// It creates one anyway, for two reasons that do matter here:
//   1. close_school_year_month/reopen_school_year_month still require
//      `current_team_member_role() is not null` (any real team member, not
//      the shared team@ login — see CLAUDE.md's "Shared dev login": team@
//      resolves currentUserId to null but IS an owner-equivalent session,
//      which is fine for reading but wrong for a suite that wants a real,
//      attributable moved_by/closed_by/done_by on every write it makes).
//   2. A dedicated signed-in browser session, isolated from whatever the
//      shared dev tunnel's default auto-login is doing concurrently.
//
// Reuses systems.ts's env loader, member fixture and browser sign-in — only
// the prefix, the email and the client-flagging setup/teardown are pipeline-
// specific. A DISTINCT email/prefix from systems.ts's own (not a suffix of
// "E2E TEST — ", per staff-access.spec's own precedent) so a parallel run of
// that suite can never delete this one's fixtures mid-test, or vice versa.
import {
  loadSystemsTestEnv,
  setupMember,
  teardownOwner,
  signInBrowserAs,
  type SystemsFixture,
  type SystemsTestEnv,
} from "./systems";

export { loadSystemsTestEnv, signInBrowserAs };
export type { SystemsFixture, SystemsTestEnv };

/** Every row this suite creates carries this on its identifying text column. */
export const E2E_PIPELINE_PREFIX = "E2E PIPELINE — ";
export const E2E_PIPELINE_OWNER_EMAIL = "e2e-pipeline-owner@convertedclick.co.za";

export function setupPipelineOwner(env: SystemsTestEnv): Promise<SystemsFixture> {
  return setupMember(env, "owner", E2E_PIPELINE_OWNER_EMAIL);
}

/** Flags a throwaway client as a school — the board's leading "Not started"
 *  column is the entry point the journey test starts from. */
export async function seedSchoolClient(
  fixture: SystemsFixture,
  name: string,
  town: string,
): Promise<{ clientId: string }> {
  const { data, error } = await fixture.admin
    .from("clients")
    .insert({ name, short_name: name, is_school: true, town })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`pipeline e2e setup: could not seed school client: ${error?.message}`);
  }
  return { clientId: data.id };
}

/** Deletes everything this run created, by prefix rather than by tracked id.
 *  `clients` cascades to school_years (on delete cascade) which cascades to
 *  school_year_months/school_tasks, and separately cascades straight to
 *  client_approvals (both FKs point at clients.id) — so one delete unwinds
 *  the whole tree even if a crash left a year half-built.
 *
 *  tg_school_tasks_guard applies its "closed month" check to EVERY write
 *  that touches a task sitting in a closed month, not just a move — so once
 *  the journey test closes M1, the client_approvals cascade delete's own
 *  ON DELETE SET NULL onto school_tasks.client_approval_id trips the same
 *  guard and the whole `clients` delete fails. Real users never hard-delete
 *  a client (archived_at is the pattern elsewhere in this app), so this
 *  reopens any month the run closed before deleting — cheaper and safer
 *  than loosening a guard nothing else needs loosened. */
export async function teardownPipeline(
  fixture: SystemsFixture,
  namePrefix: string = E2E_PIPELINE_PREFIX,
): Promise<void> {
  const { data: clients } = await fixture.admin
    .from("clients")
    .select("id")
    .like("name", `${namePrefix}%`);
  const clientIds = (clients ?? []).map((c) => c.id);
  if (clientIds.length) {
    const { data: years } = await fixture.admin
      .from("school_years")
      .select("id")
      .in("client_id", clientIds);
    const yearIds = (years ?? []).map((y) => y.id);
    if (yearIds.length) {
      await fixture.admin
        .from("school_year_months")
        .update({ closed_at: null, closed_by: null })
        .in("year_id", yearIds)
        .not("closed_at", "is", null);
    }
  }

  await fixture.admin.from("clients").delete().like("name", `${namePrefix}%`);
  // team_members + auth user. Its own system_definitions delete-by-prefix is
  // a harmless no-op here — this suite never creates one.
  await teardownOwner(fixture, namePrefix);
}
