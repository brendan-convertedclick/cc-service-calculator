-- 0139_client_signoff_inbox.sql
-- Apply via mcp__cc-supabase__apply_migration (name: client_signoff_inbox)
--
-- The client sign-off inbox: a no-login page at /review/:token where a client
-- sees everything waiting on them and decides. Two new tables plus a contacts
-- backfill, because the identity step ("And you are?") lists that company's
-- known contacts and contacts currently holds 2 rows across 37 active clients.
--
-- Additive only: no DROP, no destructive ALTER.

-- ---------------------------------------------------------------------------
-- 1. client_review_tokens — one opaque link, scoped to one client.
-- ---------------------------------------------------------------------------
-- The token itself is never stored: the edge function hashes the value from
-- the URL and looks it up here, so a database leak does not hand anyone a
-- working link. token_hash is hex sha256 of the token; the unique constraint
-- IS the lookup index — do not add a second one.
create table if not exists public.client_review_tokens (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  token_hash   text not null unique,
  label        text,                       -- "Trellidor UK — Aug 2026", for the staff side
  expires_at   timestamptz,                -- null = no expiry
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_by   uuid references public.team_members(id),  -- nullable: the shared team@ login resolves to null
  created_at   timestamptz not null default now()
);

create index if not exists client_review_tokens_client_idx
  on public.client_review_tokens (client_id);

comment on table public.client_review_tokens is
  'Opaque client-facing review links. Stores sha256(token) only; scoped to one client. Resolved by the review edge function on the service role.';

-- ---------------------------------------------------------------------------
-- 2. client_approvals — one row per thing a client must decide.
-- ---------------------------------------------------------------------------
-- Today every row hangs off a brief. item_type/item_id keep the door open for
-- a change_estimate later without a second table; brief_id stays a real FK so
-- the common case joins properly rather than through an untyped uuid.
--
-- client_title is what the client reads. It is deliberately NOT
-- briefs.raw_subject — real subjects carry "DFT V1.1", "(QC)", "REV V2.3".
--
-- No staff column of any kind lives on this table: the only two parties in the
-- client's view are the client and "Converted Click". created_by is staff-side
-- provenance and is never selected by the review edge function.
create table if not exists public.client_approvals (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  brief_id         uuid references public.briefs(id) on delete cascade,
  item_type        text not null default 'brief',
  item_id          uuid,                   -- set when item_type is not 'brief'
  client_title     text not null,          -- client-facing; never briefs.raw_subject
  ask              text not null,          -- one line: what we need from them
  detail           text,                   -- longer context, shown in the right pane
  due_date         date,
  weighty          boolean not null default false,  -- carries liability: sign-off matters legally
  state            text not null default 'pending',
  decided_at       timestamptz,
  decided_by_name  text,                   -- typed or picked at the decision, incl. "Someone else"
  decided_by_email text,
  client_note      text,                   -- the Request-changes textarea
  created_by       uuid references public.team_members(id),  -- nullable, as above
  created_at       timestamptz not null default now(),
  constraint client_approvals_state_chk
    check (state in ('pending', 'approved', 'changes_requested')),
  -- a brief item must actually point at a brief
  constraint client_approvals_brief_ref_chk
    check (item_type <> 'brief' or brief_id is not null),
  -- a decision is a decision: state and the stamp move together
  constraint client_approvals_decided_chk
    check ((state = 'pending') = (decided_at is null))
);

-- the queue the inbox page draws: this client, pending first, oldest due first
create index if not exists client_approvals_client_state_idx
  on public.client_approvals (client_id, state, due_date);

create index if not exists client_approvals_brief_idx
  on public.client_approvals (brief_id);

comment on table public.client_approvals is
  'One row per item awaiting a client decision. client_title is the client-facing title (never briefs.raw_subject). Identity is captured at the decision, not at the door, so decided_by_name/email are free text.';

comment on column public.client_approvals.weighty is
  'Item carries liability — the UI treats the sign-off as consequential rather than a routine tick.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
-- Staff read/write freely, matching this repo's posture (0021, 0118, 0126).
--
-- THERE IS DELIBERATELY NO ANON POLICY ON EITHER TABLE. The client never
-- touches Postgres: /review/:token calls an edge function that runs on the
-- service role (which bypasses RLS entirely) and returns only the fields a
-- client may see. Granting anon anything here would expose every client's
-- queue to anyone holding the anon key, which ships in the browser bundle.
-- Do not add one.
alter table public.client_review_tokens enable row level security;
alter table public.client_approvals     enable row level security;

drop policy if exists client_review_tokens_authed_all on public.client_review_tokens;
create policy client_review_tokens_authed_all on public.client_review_tokens
  for all to authenticated
  using (true) with check (true);

drop policy if exists client_approvals_authed_all on public.client_approvals;
create policy client_approvals_authed_all on public.client_approvals
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. Backfill contacts from briefs.sender_email
-- ---------------------------------------------------------------------------
-- contacts is the "And you are?" picker. With 2 rows across 37 active clients
-- there is nothing to pick, so seed it from who has actually emailed us.
--
-- Three deliberate filters, so the row count comes out well BELOW the 27 raw
-- distinct values: 7 rows across 3 clients as at 2026-08-24, verified against
-- the live DB. That is not a broken query, it is the conservative half — every
-- other client's contacts get added by hand in the client page, and the
-- "Someone else" option in the picker covers anyone not listed:
--   * our own addresses are excluded (brendan@/bianca@convertedclick.co.za and
--     the -demo domain appear as senders on client briefs). A Converted Click
--     address in a client's contact picker would put a staff name in front of
--     the client, which the feature forbids outright.
--   * case variants collapse: the unique index is on raw (client_id, email),
--     so lower() both dedupes and normalises what we insert.
--   * the sender's domain must be a KNOWN domain for that client
--     (client_domains). Without this, briefs.client_id's known mis-attributions
--     ride straight into the picker: christieg@littleflock.co.za sits on a
--     Kings College brief, so Kings College's link would offer a person from
--     another company as someone who can sign on their behalf. Attributing a
--     sign-off to the wrong company is the exact failure `weighty` exists to
--     prevent, so the backfill seeds only what we can positively vouch for.
--     Anyone omitted is added by hand in the client page.
insert into public.contacts (client_id, email, full_name)
select distinct on (b.client_id, lower(b.sender_email))
  b.client_id,
  lower(b.sender_email),
  -- "asavela.ludidi" -> "Asavela Ludidi"; "chantalj" -> "Chantalj". Good enough
  -- to recognise yourself in a list; staff can correct it in the client page.
  initcap(replace(replace(split_part(lower(b.sender_email), '@', 1), '.', ' '), '_', ' '))
from public.briefs b
where b.client_id is not null
  and b.sender_email is not null
  and b.sender_email like '%@%'
  and split_part(lower(b.sender_email), '@', 2) not like '%convertedclick%'
  and exists (
    select 1 from public.client_domains d
    where d.client_id = b.client_id
      and lower(d.domain) = split_part(lower(b.sender_email), '@', 2)
  )
  and not exists (
    select 1 from public.contacts c
    where c.client_id = b.client_id
      and lower(c.email) = lower(b.sender_email)
  )
on conflict (client_id, email) do nothing;
