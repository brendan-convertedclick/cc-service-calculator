-- 0080_clickup_user_tokens.sql
-- Per-user ClickUp OAuth tokens (Phase 1 of per-user ClickUp attribution, #5).
--
-- One row per team member who has connected their ClickUp account via OAuth.
-- ClickUp OAuth access tokens do not expire and have no refresh token, so we
-- store only the access_token plus identifying metadata.
--
-- SECURITY: these tokens are server-only credentials. RLS is enabled with NO
-- policy for the `authenticated` role, so the browser (anon/authenticated JWT)
-- can never read or write this table — every access_token read/write goes
-- through the service role inside edge functions. The frontend only ever sees
-- connection *status* (via the clickup-oauth?action=status edge fn), never the
-- token itself.

create table if not exists public.clickup_user_tokens (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null unique references public.team_members(id) on delete cascade,
  clickup_user_id text,
  clickup_username text,
  access_token text not null,
  connected_at timestamptz not null default now()
);

alter table public.clickup_user_tokens enable row level security;

-- Intentionally NO policy for the `authenticated` role: RLS with no matching
-- policy denies all access to non-service-role clients. Only the service role
-- (edge functions) may touch this table.

comment on table public.clickup_user_tokens is
  'Per-user ClickUp OAuth access tokens. Service-role only — RLS enabled with no authenticated policy so the browser can never read access_token.';
