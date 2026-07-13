# Per-User ClickUp Attribution (#5) — Scope

**Date:** 2026-07-13
**Status:** Scoping (not approved for build)

## Problem
Every ClickUp task Conductor creates is attributed to **Brendan Gunn** ("Brendan Gunn assigned this task to you"), regardless of who is operating Conductor. This is because **all** ClickUp writes use a single shared Personal Access Token (`CLICKUP_PAT`) that belongs to Brendan's ClickUp account — ClickUp sets `created by` / `assigned by` to the token owner. Conductor now has real per-user logins (e.g. `lisa@`), so Conductor-side attribution is correct, but the ClickUp write identity is still shared.

## Goal
When Lisa (or any team member) creates/assigns a ClickUp task via Conductor, ClickUp shows **"Lisa assigned this task"** — the write is authenticated as the operator, not the shared token owner.

## Root cause
ClickUp attributes an action to whoever's token authenticates the API call. To attribute to Lisa, the create call must use **Lisa's own ClickUp token**. The `assignees` array already sets who the task is *for* correctly — this only fixes who it's *from*.

## Good news: precedent exists
- **Xero OAuth** is already implemented (`xero-oauth` edge fn + `xero_oauth_tokens` storage) — a proven OAuth-connect + token-storage pattern to mirror.
- Several edge fns already identify the calling user via JWT (`createUserClient` → `auth.getUser` → email → `team_members`), e.g. `approve-staff-brief`, `create-clickup-folder`, `list-clickup-folders`.

## Approach (recommended: ClickUp OAuth, mirroring Xero)
1. **Register Conductor as a ClickUp OAuth app** (in ClickUp → Settings → Apps): get `client_id` + `client_secret`. *(Admin/Brendan action — not doable from code.)* ClickUp OAuth access tokens do **not** expire and have no refresh step (simpler than Xero).
2. **Per-user token storage** — new table `team_member_clickup_tokens` (`team_member_id` FK, `clickup_user_id`, `access_token` [encrypted / Supabase Vault], `connected_at`), RLS so a user only reads their own. Mirror how `xero_oauth_tokens` is stored.
3. **"Connect ClickUp" flow** — a button in Settings/Team: `authorize URL` → user consents → callback edge fn `clickup-oauth` exchanges `code` → stores the user's token. Mirror the Xero connect UI + `xero-oauth` callback.
4. **Use the operator's token on user-triggered writes** — refactor the shared ClickUp write helper so these paths use the **operator's** token when connected, else fall back to the shared `CLICKUP_PAT` (graceful degradation + a nudge to connect):
   - `create-quick-brief-task` (manual quick-brief)
   - `create-adhoc-project` (New Project)
   - `push-to-clickup` (scoped push)
   - `approve-staff-brief`
   - `create-retainer` / `update-retainer-services`
   - `set-brief-project` (reparent)
   The edge fn identifies the operator via their JWT (already the pattern in several fns) → fetches their token from `team_member_clickup_tokens`.
   **Unchanged (stay on shared PAT):** all `list-*` reads (no attribution), and cron/automated writes with no operator — `sync-clickup-actuals`, `create-recurring-tasks`, `provision-*`, `roll-forward-*`.

## Alternative (simpler, worse UX)
Per-user **Personal Access Tokens**: each person generates their own ClickUp PAT and pastes it into Conductor settings. No OAuth app needed, but users manage long-lived secrets by hand. Recommend OAuth.

## Edge cases / gotchas
- The operator's ClickUp user must have **access to the client's ClickUp space/list** to create tasks there (team members generally do).
- **Not-connected fallback:** if the operator hasn't connected ClickUp, use the shared PAT (Brendan attribution) so nothing breaks — surface a "Connect your ClickUp for correct attribution" nudge.
- **Cron writes** have no operator → shared PAT / system attribution (acceptable).
- **Security:** per-user ClickUp tokens are sensitive — encrypt at rest, RLS, never ship to the browser.
- The chat-notify mention (#7) already tags the correct assignee independently — unaffected.

## Rough effort / phasing
- **Phase 1 (plumbing):** ClickUp OAuth app registration (admin) + `clickup-oauth` callback fn + `team_member_clickup_tokens` table + "Connect ClickUp" UI in Settings. ~1–2 days.
- **Phase 2 (writes):** refactor the ~6 user-triggered write paths to use operator-token-with-shared-fallback. ~1 day.
- **Phase 3 (polish):** connection-status + nudge when not connected; verify attribution live. ~0.5 day.

## Decisions to confirm before build
1. OAuth (recommended) vs per-user PAT.
2. Which write paths get operator attribution (recommended: all user-triggered task creations; crons stay shared).
3. Fallback when not connected (recommended: shared PAT + nudge, so it degrades not breaks).
4. Who registers the ClickUp OAuth app (needs a ClickUp admin).
