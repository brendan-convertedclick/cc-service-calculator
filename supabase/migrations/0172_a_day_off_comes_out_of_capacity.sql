-- 0172_a_day_off_comes_out_of_capacity.sql
-- Apply via mcp__cc-supabase__apply_migration (name: a_day_off_comes_out_of_capacity)
--
-- Lisa, 2026-09-15: "a table which shows the actual calendar month, where you
-- can log people as off sick / on leave etc and that must then tie into the
-- Capacity." Capacity has assumed everyone is at their desk every working
-- day (capacity.ts: "everyone is assumed full-time"). A person on leave is
-- not 7h of capacity that day, so the /retainers ring and the Of capacity
-- column both overstate what the month could hold.
--
-- One row per person per day. No ranges: a range is just several days, and
-- a grid of days is what the page shows and edits.

create table if not exists public.team_days_off (
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('leave', 'sick', 'holiday')),
  note text,
  created_by uuid references public.team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_member_id, day)
);

comment on table public.team_days_off is
  'A working day a person was not available. Each one takes HOURS_PER_WORKING_DAY off their capacity on /retainers.';

create index if not exists team_days_off_day_idx on public.team_days_off (day);

alter table public.team_days_off enable row level security;

-- Everyone can see who is off: it is the same fact the capacity page shows.
create policy team_days_off_authed_read on public.team_days_off
  for select to authenticated using (true);

-- You may log your own days; admin and owner may log anyone's.
create policy team_days_off_write on public.team_days_off
  for all to authenticated
  using (
    current_team_member_role() in ('admin', 'owner')
    or team_member_id in (select id from public.team_members where auth_user_id = auth.uid())
  )
  with check (
    current_team_member_role() in ('admin', 'owner')
    or team_member_id in (select id from public.team_members where auth_user_id = auth.uid())
  );
