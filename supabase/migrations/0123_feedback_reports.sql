-- 0123_feedback_reports.sql
--
-- Bug reports and feedback, raised from anywhere in the app and triaged on
-- /feedback by admin/owner. One table: screenshots live as storage paths on
-- the row (upload first, then a single insert), so there is no attachment
-- table and no transaction to coordinate.
--
-- Triage is two outcomes: resolved, or discarded *with a reason*. The reason
-- is a database constraint rather than dialog validation — "discarded, no
-- note" is the state that makes the queue useless a month later.

create table if not exists public.feedback_reports (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'bug' check (kind in ('bug', 'feedback')),
  summary          text not null check (btrim(summary) <> ''),
  details          text not null default '',
  -- Where they were and what they were using — the two things that turn
  -- "it broke" into something reproducible.
  page_path        text,
  user_agent       text,
  screenshot_paths text[] not null default '{}',
  status           text not null default 'open' check (status in ('open', 'resolved', 'discarded')),
  resolution_note  text,
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id),
  created_by       uuid not null default auth.uid() references auth.users(id),
  -- Denormalised so the triage list needs no join: the shared team@ login has
  -- no team_members row, and a report from it must still say who sent it.
  created_by_email text,
  created_at       timestamptz not null default now(),
  constraint feedback_reports_discard_needs_reason
    check (status <> 'discarded' or nullif(btrim(resolution_note), '') is not null)
);

create index if not exists feedback_reports_status_idx
  on public.feedback_reports (status, created_at desc);

alter table public.feedback_reports enable row level security;

-- Everyone reports, everyone can see what has been reported (this is an
-- internal tool — a duplicate report is worse than a visible one).
drop policy if exists feedback_reports_select on public.feedback_reports;
create policy feedback_reports_select on public.feedback_reports
  for select to authenticated using (true);

drop policy if exists feedback_reports_insert on public.feedback_reports;
create policy feedback_reports_insert on public.feedback_reports
  for insert to authenticated
  with check (created_by = (select auth.uid()));

-- Triage is the admin act, matching 0118's posture on the systems library.
drop policy if exists feedback_reports_triage on public.feedback_reports;
create policy feedback_reports_triage on public.feedback_reports
  for update to authenticated
  using (current_team_member_role() = any (array['admin', 'owner']))
  with check (current_team_member_role() = any (array['admin', 'owner']));

-- Screenshots: private bucket, path `{auth uid}/{uuid}-{name}`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "feedback screenshots read" on storage.objects;
create policy "feedback screenshots read" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-screenshots');

-- You may only write into your own folder, so one person's upload can never
-- be passed off as evidence on someone else's report.
drop policy if exists "feedback screenshots write" on storage.objects;
create policy "feedback screenshots write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Same folder rule for removal: without this nothing can ever clear a
-- screenshot, so a mis-uploaded image would sit in the bucket forever.
drop policy if exists "feedback screenshots delete own" on storage.objects;
create policy "feedback screenshots delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feedback-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
