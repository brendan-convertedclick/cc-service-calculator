-- 0193_contact_moments.sql
--
-- Moments: the personal dates an account owner keeps about the people they
-- deal with at a school — a birthday, a child's matric dance, ten years at
-- the school — so that somebody remembers to ask. It is relationship memory,
-- not work: nothing here is a task, nothing is owed, and none of it is ever
-- shown to the client.
--
-- Two tables, and only what cannot be derived:
--
--   contact_moments       one row per date worth remembering, hung off an
--                         existing `contacts` row. A birthday or anniversary
--                         repeats every year from `on_date`; an event happens
--                         once. The calendar expands repeats at read time
--                         (src/lib/contact-moments.ts) rather than storing a
--                         row per year, which would need a job to keep ahead
--                         of the calendar and would drift the moment anyone
--                         corrected the date.
--
--   contact_moment_asks   "somebody asked about this". Keyed by the
--                         occurrence (`occurs_on`), not the moment, because a
--                         birthday asked about last year has not been asked
--                         about this year. `stage` separates wishing someone
--                         luck before an event from asking how it went after
--                         — two conversations, both worth not having twice.
--
-- The FK to contacts is the composite (contact_id, client_id) that 0142 added
-- the unique index for, so "this person is at this school" is a database
-- guarantee and the calendar can filter by school without a join through
-- contacts. Deleting a contact cascades: a person who has left takes their
-- birthday with them.
--
-- RLS matches contacts (0021): any authenticated user. The route is
-- admin/owner in the app, like the rest of the Account Owner section. The
-- client-review edge function never reads these tables.

create table if not exists public.contact_moments (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null,
  client_id      uuid not null references public.clients(id) on delete cascade,
  kind           text not null
                 constraint contact_moments_kind_chk
                 check (kind in ('birthday', 'event', 'anniversary')),
  -- A birthday is named by its person; everything else needs words.
  title          text
                 constraint contact_moments_title_chk
                 check (kind = 'birthday' or length(btrim(coalesce(title, ''))) > 0),
  on_date        date not null,
  repeats_yearly boolean not null default false,
  ask_about      text,
  notes          text,
  created_by     uuid references public.team_members(id) on delete set null,  -- null for the shared team@ login
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint contact_moments_contact_fk
    foreign key (contact_id, client_id)
    references public.contacts (id, client_id)
    on delete cascade
);

create index if not exists contact_moments_client_idx  on public.contact_moments (client_id);
create index if not exists contact_moments_contact_idx on public.contact_moments (contact_id);

create table if not exists public.contact_moment_asks (
  moment_id  uuid not null references public.contact_moments(id) on delete cascade,
  occurs_on  date not null,
  stage      text not null default 'before'
             constraint contact_moment_asks_stage_chk
             check (stage in ('before', 'after')),
  asked_by   uuid references public.team_members(id) on delete set null,
  asked_at   timestamptz not null default now(),
  primary key (moment_id, occurs_on, stage)
);

create or replace function public.tg_contact_moments_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists contact_moments_touch on public.contact_moments;
create trigger contact_moments_touch
  before update on public.contact_moments
  for each row execute function public.tg_contact_moments_touch();

alter table public.contact_moments     enable row level security;
alter table public.contact_moment_asks enable row level security;

drop policy if exists contact_moments_authed_all on public.contact_moments;
create policy contact_moments_authed_all on public.contact_moments
  for all to authenticated using (true) with check (true);

drop policy if exists contact_moment_asks_authed_all on public.contact_moment_asks;
create policy contact_moment_asks_authed_all on public.contact_moment_asks
  for all to authenticated using (true) with check (true);
