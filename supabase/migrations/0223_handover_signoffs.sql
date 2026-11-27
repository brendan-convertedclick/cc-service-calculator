-- 0204_handover_signoffs.sql
-- Apply via mcp__cc-supabase__apply_migration (name: handover_signoffs)
--
-- The doer's hand-over becomes the sign-off. When someone finishes a briefed
-- task they leave a closing comment saying what was done, attach the proof,
-- and move the ClickUp task to "send to client". handover-signoffs (cron, plus
-- clickup-webhook when it fires) turns that into a client_approvals row.
--
-- Until 2026-11 a sign-off row was only ever drafted by a person from the
-- candidates list, and the person who checked work before it reached a client
-- (Lisa) is leaving. Two things replace her:
--   * a gate — no closing comment, or no proof (a file or a link), and nothing
--     is drafted: the task goes back to the doer by name; and
--   * the row is born PARKED, so it is off the client's page and off every
--     clock until a person with a Google grant presses Send on /client-signoffs.
--     Parked is already staff-only by construction (0148): the client-review
--     list, reply and decide queries all filter it out in the query.
--
-- handed_over_by is a STAFF NAME and must never reach a client. It is not in
-- APPROVAL_COLUMNS (_shared/review-list.ts) and must not be added: our side of
-- the client's page is always "Converted Click" (0144).
--
-- proof is the frozen copy of what was attached, in the private signoff-proof
-- bucket: [{ name, path, mime, size }]. Copied rather than linked because a
-- ClickUp attachment URL is not something a client can be relied on to open,
-- and because evidence that can change after a sign-off is not evidence (0142).

alter table client_approvals
  add column handed_over_at timestamptz,
  add column handed_over_by text,
  add column proof jsonb not null default '[]'::jsonb;

alter table client_approvals
  add constraint client_approvals_handover_brief_chk
    check (handed_over_at is null or (item_type = 'brief' and brief_id is not null));

comment on column client_approvals.handed_over_at is
  'Set when handover-signoffs drafted this row from a ClickUp task moved to "send to client" with a closing comment and proof. Null for rows a person drafted.';
comment on column client_approvals.handed_over_by is
  'STAFF-ONLY. The ClickUp name of whoever wrote the closing comment. Never in APPROVAL_COLUMNS: the client sees "Converted Click", never a staff name.';
comment on column client_approvals.proof is
  'Frozen copies of the task''s proof files in the private signoff-proof bucket: [{name, path, mime, size}]. Served to the client as short-lived signed URLs by client-review.';

-- one live hand-over per brief: a second "send to client" while the first is
-- still parked or pending must not draft a duplicate (the cron and the webhook
-- can both see the same move)
create unique index if not exists client_approvals_one_open_handover
  on client_approvals (brief_id)
  where handed_over_at is not null and state in ('parked', 'pending');

insert into storage.buckets (id, name, public, file_size_limit)
values ('signoff-proof', 'signoff-proof', false, 26214400)
on conflict (id) do nothing;

-- Staff read the proof in the sign-off preview with their own session. Writes
-- come only from the service role (handover-signoffs), which bypasses RLS.
drop policy if exists signoff_proof_staff_read on storage.objects;
create policy signoff_proof_staff_read on storage.objects
  for select to authenticated
  using (bucket_id = 'signoff-proof');

-- every 10 minutes: the backstop for a webhook ClickUp never sent
select cron.schedule(
  'handover-signoffs',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/handover-signoffs',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
