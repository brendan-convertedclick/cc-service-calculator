-- 0141_client_waiting_questions_agreements.sql
-- Apply via mcp__cc-supabase__apply_migration (name: client_waiting_questions_agreements)
--
-- Three things the client sign-off surface could not say before:
--
--   1. WHO IS THE DELAY. briefs.client_wait_ms already banked the minutes a
--      ClickUp task sat in "waiting on client". On its own that number proves
--      nothing — a client answers "you were slow too" and there is no figure
--      to put next to it. internal_wait_ms is that figure: the minutes the
--      same task sat in a status that was OURS (backlog / planned / in
--      progress). Two numbers, one row, from one ClickUp response.
--
--   2. QUESTIONS. A thing we asked, which needs an ANSWER, not an approval.
--
--   3. AGREEMENTS. A thing the client committed to in a meeting or an email,
--      by a date, which needs DOING. The point is accountability: what, when
--      it was agreed, and how — because "you said in the meeting on the 4th"
--      only carries weight if it is written down.
--
-- (2) and (3) reuse client_approvals rather than growing two more tables. It
-- already has the client_id scoping, the RLS, the pending/decided state
-- machine and — the part that matters — it is the single thing the client
-- portal reads. A question in a second table is a question the client never
-- sees. item_type is the discriminator it was always intended to be.
--
-- Additive only: no DROP, no destructive ALTER.

-- ---------------------------------------------------------------------------
-- 1. briefs.internal_wait_ms — the other half of the delay story.
-- ---------------------------------------------------------------------------
alter table public.briefs
  add column if not exists internal_wait_ms bigint;

comment on column public.briefs.internal_wait_ms is
  'Cumulative ms the ClickUp task spent in a status that was OURS (anything that is neither a client-waiting status nor closed). The counterpart to client_wait_ms: together they say who the delay belongs to. Written by sync-clickup-actuals from ClickUp bulk time_in_status.';

-- ---------------------------------------------------------------------------
-- 2. client_approvals — questions and agreements alongside tasks.
-- ---------------------------------------------------------------------------
-- item_type has carried a free-text default of 'brief' since 0139. Constrain
-- it now that it means something. 'brief' is NOT renamed to 'task' — the
-- candidates flow, the existing rows and client_approvals_brief_ref_chk all
-- key off that value; "Task" is a label the UI puts on it.
alter table public.client_approvals
  add column if not exists agreed_at date,
  add column if not exists agreed_via text,
  add column if not exists outbound_email_id uuid
    references public.outbound_emails(id) on delete set null;

comment on column public.client_approvals.agreed_at is
  'item_type = agreement only: the date the client committed, which is NOT created_at — an agreement made in a meeting is usually captured days later.';

comment on column public.client_approvals.agreed_via is
  'item_type = agreement only: how it was agreed. "In the meeting on the 4th" is the sentence that makes an agreement stick, so where it happened is recorded, not inferred.';

comment on column public.client_approvals.outbound_email_id is
  'The email that carried this item to the client, if one did. A FK rather than a copy of the recipients: outbound_emails already holds to/subject/body/sent_at, and a second copy would drift.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_approvals_item_type_chk'
  ) then
    alter table public.client_approvals
      add constraint client_approvals_item_type_chk
      check (item_type in ('brief', 'question', 'agreement'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'client_approvals_agreed_via_chk'
  ) then
    alter table public.client_approvals
      add constraint client_approvals_agreed_via_chk
      check (agreed_via is null or agreed_via in ('meeting', 'call', 'email', 'message', 'other'));
  end if;

  -- An agreement without a date is a grievance, not a record. Anything the
  -- staff form can leave blank, it may — but not the two fields the whole
  -- feature exists to hold a client to.
  if not exists (
    select 1 from pg_constraint where conname = 'client_approvals_agreement_chk'
  ) then
    alter table public.client_approvals
      add constraint client_approvals_agreement_chk
      check (item_type <> 'agreement' or (agreed_at is not null and agreed_via is not null));
  end if;
end $$;

-- The portal and the staff table both filter by type within a client.
create index if not exists client_approvals_client_type_idx
  on public.client_approvals (client_id, item_type, state);
