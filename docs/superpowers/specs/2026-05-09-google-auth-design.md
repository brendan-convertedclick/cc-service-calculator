# Google OAuth + Multi-User Auth — Design Spec

**Date:** 2026-05-09  
**Status:** Approved

## Overview

Replace the single shared login with individual Google OAuth sign-ins for all team members, while keeping the existing email/password path as a fallback. All signed-in users have full access (no roles in V1). New users are auto-provisioned into `team_members` on first Google sign-in.

## Scope

- Enable Google OAuth via Supabase Auth
- Add `signInWithGoogle()` to `AuthContext`
- Domain-restrict to `@convertedclick.co.za`
- Auto-provision `team_members` row on first Google sign-in
- Add Google sign-in button to the Login page

## Out of Scope

- Per-user roles or permissions (V1 is flat admin for all)
- Removing the shared `team@convertedclick.co.za` email/password login
- Server-side Auth Hook domain enforcement (Approach B — deferred)
- Invite flows or user management UI

---

## Section 1: Supabase Configuration (manual, one-time)

1. In Supabase dashboard → Authentication → Providers → Google: enable and paste Google Cloud OAuth 2.0 Client ID + Secret.
2. Create credentials in Google Cloud Console: Web Application type, with the Supabase callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`) as an authorised redirect URI.
3. Add allowed redirect URLs in Supabase Auth settings:
   - `http://localhost:5174`
   - Production URL (when available)

This is a manual prerequisite. No code changes in this step.

---

## Section 2: `AuthContext` changes

File: `src/context/AuthContext.tsx`

### 2a. New context value — `signInWithGoogle`

```ts
signInWithGoogle: () => supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: window.location.origin,
    queryParams: { hd: 'convertedclick.co.za' },
  },
})
```

`hd` is a Google hint that pre-filters the account picker to company accounts. It is not a hard server-side block — domain validation is enforced separately (see 2b).

### 2b. Domain guard in `onAuthStateChange`

When a new session arrives (event `SIGNED_IN`), check:

```ts
if (!session.user.email?.endsWith('@convertedclick.co.za')) {
  await supabase.auth.signOut()
  setDomainError(true)
  return
}
setDomainError(false)
```

Add `domainError: boolean` to the context value so the Login page can surface the message.

### 2c. Auto-provisioning in the `currentUserId` resolver

In the existing `useEffect` keyed on `session?.user?.email`:

- If the Supabase query returns `data === null` (no `team_members` row) AND the email ends with `@convertedclick.co.za`:
  - Insert a new `team_members` row: `{ full_name: session.user.user_metadata.full_name ?? email, email }`
  - Set `currentUserId` to the new row's `id`
- If `data` is found, set `currentUserId` as today
- The shared `team@convertedclick.co.za` login still yields `currentUserId = null` (no row for it — intentional V1 behaviour)

---

## Section 3: Login page

File: `src/pages/Login.tsx`

- Add a **"Sign in with Google"** button at the top of the card, before the email/password form.
- Separate with a centred **"or"** divider.
- On click: call `signInWithGoogle()` from context. Supabase handles the redirect; no further client logic needed on the button.
- If `domainError` is true (set by AuthContext after a rejected Google sign-in): show a message below the Google button — *"Only @convertedclick.co.za accounts are allowed."*
- The pre-filled `team@convertedclick.co.za` email and password field remain unchanged for the fallback path.

---

## Data model impact

No schema migrations required. Auto-provisioning writes to the existing `team_members` table using columns that are already nullable or have defaults:

| Column | Source | Notes |
|---|---|---|
| `full_name` | `user_metadata.full_name` from Google | Falls back to email if missing |
| `email` | `session.user.email` | |
| `primary_department_id` | null | Set manually later |
| `cost_rate_cents` | null | Set manually later |
| `skills` | `'{}'` (default) | |

---

## Dev mode behaviour

`AuthContext` currently fakes a `DEV_SESSION` in development (`import.meta.env.DEV`). This is unchanged — local development continues to bypass real auth. The `signInWithGoogle` path is only reachable in production or when `DEV` is false.

---

## Success criteria

- A team member can click "Sign in with Google", pick their `@convertedclick.co.za` account, and land on the dashboard.
- On first sign-in, a `team_members` row is created for them; subsequent sign-ins resolve their existing `currentUserId`.
- A non-company Google account is rejected with a clear error message.
- The shared email/password login continues to work.
- No existing functionality (brief attribution, quote locking, etc.) regresses.
