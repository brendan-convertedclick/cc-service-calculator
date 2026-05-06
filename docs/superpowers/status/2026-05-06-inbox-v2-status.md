# Inbox v2 — execution status

**Last updated:** 2026-05-06
**Branch:** `feat/inbox-v2-phase-1` (15 commits ahead of `main`, NOT merged, NO PR open)

## Phase 1 — Intake + threading

Plan: [`docs/superpowers/plans/2026-05-05-inbox-v2-phase-1-intake-threading.md`](../plans/2026-05-05-inbox-v2-phase-1-intake-threading.md)

| # | Task | Status |
|---|------|--------|
| 1 | Migration 0023 — `brief_messages`, `relay_secrets`, thread aggregates | ✅ done |
| 2 | HMAC helper — sign + verify + token generator | ✅ done |
| 3 | Edge function — `issue-relay-token` (deployed v2 ACTIVE) | ✅ done |
| 4 | `relay-auth.ts` shared helper + `gmail-relay` skeleton | ✅ done |
| 5 | `gmail-relay` upsert + attachment upload (deployed v2 ACTIVE; smoke-tested) | ✅ done |
| 6 | Apps Script template + setup README | ✅ done |
| 7 | `useRelayTokens` hook | ✅ done |
| 8 | Settings → Connect Gmail page + route | ✅ done |
| — | Final review pass | ✅ done — Ready to merge |
| 9 | End-to-end manual test (Brendan dogfoods Apps Script in own Gmail) | ⬜ pending — gates Phase 1 sign-off |

## Phase 2 — Inbox UI rewrite

Plan: [`docs/superpowers/plans/2026-05-05-inbox-v2-phase-2-ui.md`](../plans/2026-05-05-inbox-v2-phase-2-ui.md)
Status: not started — gated on Phase 1 sign-off.

## Phase 3 — Wiki context for AI scoping

Plan: [`docs/superpowers/plans/2026-05-05-inbox-v2-phase-3-wiki-context.md`](../plans/2026-05-05-inbox-v2-phase-3-wiki-context.md)
Status: not started — gated on Phase 2 sign-off + the four out-of-band prerequisites listed at the top of the Phase 3 plan (push CC-Vault to GitHub, mint PAT, set Supabase secrets `WIKI_GITHUB_PAT` / `WIKI_GITHUB_REPO` / `WIKI_GITHUB_BRANCH`, populate at least one `wiki/clients/<Slug>/` folder).

## Tracked follow-ups (don't block merge of Phase 1)

- **M-4:** RLS hardening migration on `brief_messages` + `relay_secrets` before teammate rollout. Pattern in `0021_enable_rls_on_intake_pipeline.sql`.
- **M-5:** Set `briefs.received_at = messages[0].sent_at` in `gmail-relay` (currently defaults to insert time, sorts threads by relay time not send time).
- **M-6:** Skip the brief aggregate refresh in `gmail-relay` when `inserted == 0` (avoids `updated_at` churn on no-op replays).
- **I-4:** Extend `cors()` for `x-relay-*` headers OR drop `gmail-relay`'s OPTIONS branch entirely. Only matters if anyone calls `gmail-relay` from a browser; Apps Script doesn't issue preflight.
- **`gmail_thread_id_unique`** appears as writable in TS Insert/Update types — auto-generator quirk; wrap with `Omit<…>` at any future call site that destructures the type.
- **`brief_messages`** has no `updated_at`; intentional (notes are post-only). Add the column if note editing is added later.
- **`splitAddrs`** in Apps Script naively `.split(',')` — corrupts To/Cc parsing for senders with commas in display names. Spec-accurate; relay delivery unaffected; cosmetic only.

## Plan-level decisions captured (deviations from spec)

- **`relay_secrets.secret` stores plaintext** (not bcrypt). Spec was internally contradictory — HMAC validation requires plaintext server-side. Same threat model as `CLICKUP_PAT`/`ANTHROPIC_API_KEY` Supabase secrets. Documented in migration comment + Phase 1 plan deviation note.
- **No RLS on new tables.** V1 scope; tracked as M-4 for hardening before broader rollout.
- **Triage actions move to conversation pane in Phase 2** (not the row). Documented in Phase 2 plan.
- **No virtualised list in Phase 2 v1.** Add `react-virtuoso` only if brief count crosses ~500.

## Next action for the human

Run Task 9 manual end-to-end:

1. Install `apps-script/inbox-relay.gs` in your Gmail per `apps-script/README.md`.
2. Mint a token via Settings → Connect Gmail → Generate.
3. Forward yourself an email, label it `→Inbox/Push`, run `forceSync()` in Apps Script editor.
4. Confirm the brief appears in the Inbox with the message threaded under it.
5. Reply, label `→Inbox/Push-Sent`, re-sync, confirm the outbound message appears.
6. Re-run `forceSync()` twice with no new threads — confirm nothing duplicates.

If that all works → Phase 1 closes; merge `feat/inbox-v2-phase-1` to `main` (or open a PR and review the diff first).
If something fails → report back; do not roll out Apps Script to other teammates yet.
