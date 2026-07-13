# Per-User ClickUp Attribution (#5) — Build Plan

**Decisions (confirmed):** (1) OAuth "Connect ClickUp" per person; (2) fallback to shared `CLICKUP_PAT` + a nudge when not connected; (3) client registers the ClickUp OAuth app.

**Pattern to mirror:** `supabase/functions/xero-oauth/index.ts` (single fn, `?action=start|callback|disconnect`, secrets `XERO_CLIENT_ID/SECRET`, redirect `${SUPABASE_URL}/functions/v1/xero-oauth?action=callback`, `SITE_URL` for post-connect redirect) + `Settings.tsx` "Connect Xero" href. Difference: Xero is **org-level** (one token in `settings.xero_oauth_tokens`); ClickUp is **per-user**.

**Secrets (set once client provides them):** `CLICKUP_OAUTH_CLIENT_ID`, `CLICKUP_OAUTH_CLIENT_SECRET`. Redirect registered in ClickUp: `https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/clickup-oauth`.

**ClickUp OAuth facts (confirm via context7 during build):** authorize `https://app.clickup.com/api?client_id=..&redirect_uri=..&state=..`; token exchange `POST https://api.clickup.com/api/v2/oauth/token` (client_id, client_secret, code) → `{ access_token }` (no refresh, no expiry); `GET /api/v2/user` with the token → the authorized ClickUp user (id, username). `state` is echoed to the callback — use it to carry WHO is connecting.

---

## PHASE 1 — OAuth plumbing (build + deploy now; live once secrets set)

### Task 1: token storage
- Migration `0080_clickup_user_tokens.sql`: table `clickup_user_tokens` (`id uuid pk default gen_random_uuid()`, `team_member_id uuid unique references team_members(id) on delete cascade`, `clickup_user_id text`, `clickup_username text`, `access_token text not null`, `connected_at timestamptz default now()`).
- **Security:** tokens are server-only. Enable RLS with **no policy for `authenticated`** (deny) so only the service role (edge fns) can read/write — the browser must never read `access_token`. (Frontend gets connection *status* via an edge fn, not by selecting this table.)
- Regenerate/patch `db.ts` for the new table.

### Task 2: `clickup-oauth` edge fn (mirror xero-oauth, per-user)
`?action=start` → require the caller's user JWT (`createUserClient` → `auth.getUser` → `team_members` by email → member id); build a **signed** `state` (HMAC of member id with a server secret, or a short-lived nonce row) and redirect to ClickUp authorize with `client_id`, `redirect_uri`, `state`. Since an `<a href>` can't send an auth header, expose `?action=start` as a fn the frontend calls WITH the session (fetch → returns the authorize URL as JSON or a 302 the frontend follows) — OR pass the member id in `state` and validate it's a real member (acceptable for internal V1; prefer signed).
`callback` (detect by presence of `code`) → exchange code → `access_token`; `GET /api/v2/user` → clickup user id/username; upsert `clickup_user_tokens` for the state's member id; redirect to `${SITE_URL}/settings?clickup=connected`.
`?action=status` (caller JWT) → `{ connected: boolean, clickup_username }` for the current user (service-role read, returns status only, never the token).
`?action=disconnect` (caller JWT) → delete the row.
Secrets: `CLICKUP_OAUTH_CLIENT_ID`, `CLICKUP_OAUTH_CLIENT_SECRET`, `SITE_URL`, plus a signing secret if signing state.

### Task 3: Settings "Connect ClickUp" UI
Mirror the Xero card in `Settings.tsx`: a "Connect ClickUp" button (starts the flow), and when connected show the ClickUp username + a Disconnect button + reflect `?clickup=connected`. Reads status via `clickup-oauth?action=status`. Per-person (shows the signed-in user's own connection).

---

## PHASE 2 — Route writes through the operator's token

### Task 4: shared helper `_shared/clickup-token.ts`
`getOperatorClickupToken(sb, req): Promise<{ token: string; via: "user" | "shared"; clickupUserId?: number }>` — resolve the caller (`createUserClient(req)` → `auth.getUser` → email → team_member) → look up `clickup_user_tokens` (service role) → return their `access_token` (`via:"user"`) else the shared `CLICKUP_PAT` (`via:"shared"`). Never throws — always returns a usable token.

### Task 5: rewire the user-triggered write paths
Replace `Deno.env.get("CLICKUP_PAT")` with `getOperatorClickupToken(...)` in the create/assign paths so the ClickUp writes authenticate as the operator (attribution = them), falling back to shared:
- `create-quick-brief-task`, `create-adhoc-project`, `push-to-clickup`, `approve-staff-brief`, `create-retainer`, `update-retainer-services`, `set-brief-project`, `create-client-list`, `create-clickup-folder`.
- **Unchanged (stay on shared `CLICKUP_PAT`):** all `list-*` reads, `sync-clickup-actuals`, `create-recurring-tasks`, `provision-*`, `roll-forward-*` (cron/automated, no operator).
- Return `via` in responses (optional) so the frontend can show a "you're posting as shared — connect your ClickUp" nudge.

### Task 6: nudge + verify
Frontend nudge when a create returns `via:"shared"` (or when status shows not-connected). Live test: Lisa connects → briefs a task → ClickUp shows "Lisa assigned this task".

---

## Sequencing
Phase 1 first (build + deploy; dormant until secrets set). Then set secrets when client provides Client ID/Secret + do a live connect test. Then Phase 2 (rewire writes) + final attribution test.
