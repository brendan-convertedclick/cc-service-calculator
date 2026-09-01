-- 0143_client_activity.sql
-- Apply via mcp__cc-supabase__apply_migration (name: client_activity)
--
-- The touch-point log for one thing a client owes us: what we asked, when we
-- chased, whether they have opened their link, and what they decided.
--
-- ONE TABLE, NOT A FULL EVENT LOG. Most of that timeline already exists in
-- columns and is derived at read time rather than duplicated here:
--
--   asked      client_approvals.created_at
--   emailed    outbound_emails, via client_approvals.outbound_email_id and
--              client_activity.outbound_email_id below
--   opened     client_review_tokens.last_used_at — and since 0142 a token
--              belongs to one person, so that already says WHO opened it and
--              when, which is the question anyone chasing actually has
--   decided    client_approvals.decided_at / decided_by_name / client_note
--
-- Writing those as event rows too would give two sources for one fact and a
-- guaranteed drift. What has nowhere else to live is a message somebody typed
-- — so that, and only that, is what this table holds.
--
-- Additive only: no DROP, no destructive ALTER.

create table if not exists public.client_activity (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  approval_id       uuid not null references public.client_approvals(id) on delete cascade,
  kind              text not null default 'message',
  body              text not null,
  -- The email that carried a message out, when one did. A note has none.
  outbound_email_id uuid references public.outbound_emails(id) on delete set null,
  -- Nullable: the shared team@ login resolves currentUserId to null, and a
  -- note written under it is still worth keeping.
  created_by        uuid references public.team_members(id),
  created_at        timestamptz not null default now(),
  constraint client_activity_kind_chk check (kind in ('message', 'note')),
  constraint client_activity_body_chk check (length(btrim(body)) > 0)
);

comment on table public.client_activity is
  'Messages and internal notes against one client_approvals row. Everything else on the item timeline is derived from existing columns rather than duplicated here — see the header of this migration.';

comment on column public.client_activity.kind is
  'message = sent to the client by email, and they can read it on their sign-off page. note = ours only, never leaves this database. The distinction is the whole point: a chase you can see and a thought you cannot must not look alike.';

-- The panel reads one item newest-last; the client page reads one client.
create index if not exists client_activity_approval_idx
  on public.client_activity (approval_id, created_at);

create index if not exists client_activity_client_idx
  on public.client_activity (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — staff read/write, matching this repo's posture (0021, 0118, 0126, 0139).
-- ---------------------------------------------------------------------------
-- NO ANON POLICY, deliberately, exactly as 0139. A client reaches messages
-- through the client-review edge function on the service role, which selects
-- the message rows explicitly and never the notes. Granting anon anything here
-- would hand every internal note to anyone holding the anon key, which ships
-- in the browser bundle.
alter table public.client_activity enable row level security;

drop policy if exists client_activity_authed_all on public.client_activity;
create policy client_activity_authed_all on public.client_activity
  for all to authenticated
  using (true) with check (true);
