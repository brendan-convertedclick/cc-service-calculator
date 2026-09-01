-- 0144_client_activity_two_way.sql
-- Applied 2026-08-31 via mcp__cc-supabase__apply_migration
-- (name: client_activity_two_way). Written to disk 2026-09-01 — it was applied
-- from the tool without the file being committed, so the directory did not
-- reproduce the live schema. If a migration is worth applying it is worth
-- leaving on disk; do not apply one without writing it here.
--
-- The thread runs both ways.
--
-- 0143 gave a client an item they could read and a decision they could make,
-- and nowhere to answer. Everything they wanted to say — "the logos are with
-- marketing, give me till Friday" — had to come back by email into somebody's
-- inbox, where it left the record entirely.
--
-- THREE KINDS NOW, AND THEY MUST NEVER BE CONFUSABLE IN ANY UI:
--
--   message         we sent it, it was emailed, and they can see it
--   client_message  they wrote it back on their own page
--   note            ours only, and it never leaves this database
--
-- The client-facing query filters to ('message','client_message') IN THE
-- QUERY, not in JS, in both the edge function and the staff preview mirror.
-- An internal note reaching a client is the one unrecoverable failure on that
-- page, so a later refactor of the mapping must not be able to leak one.
--
-- A reply is deliberately NOT a decision. `client-review`'s action:"reply"
-- leaves the item pending, because answering a question and approving it are
-- different acts and conflating them would sign off things nobody signed off.
--
-- Additive only: no DROP, no destructive ALTER.

-- ---------------------------------------------------------------------------
-- 1. The third kind.
-- ---------------------------------------------------------------------------
alter table public.client_activity
  drop constraint if exists client_activity_kind_chk;

alter table public.client_activity
  add constraint client_activity_kind_chk
  check (kind in ('message', 'note', 'client_message'));

comment on column public.client_activity.kind is
  'message = we sent it and they can read it on their sign-off page. client_message = they wrote it back on that page. note = ours only, never leaves this database. The distinction is the whole point: a chase you can see, a reply from them, and a thought you cannot show must not look alike.';

-- ---------------------------------------------------------------------------
-- 2. Who wrote it, on their side.
-- ---------------------------------------------------------------------------
-- The author comes from the token contact (0142), so a personal link names the
-- person without asking them to. Nullable twice over: a legacy company-wide
-- link has nobody to name, and a client with an old link must still be able to
-- answer us rather than be refused.
alter table public.client_activity
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

-- Snapshotted, not joined. The name has to survive the contact row being
-- deleted when somebody leaves — the same reason client_approvals keeps
-- decided_by_name rather than a foreign key (0142).
alter table public.client_activity
  add column if not exists author_name text;

comment on column public.client_activity.contact_id is
  'The client contact who wrote a client_message, resolved from their review token — never from the request body, which is written by whoever holds the link. Null on a legacy shared link.';

comment on column public.client_activity.author_name is
  'Their name as at the moment they wrote it. A snapshot, so it survives the contact being deleted.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
-- Unchanged, and still NO ANON POLICY. A client writes a reply through the
-- client-review edge function on the service role, which resolves them from
-- their token. Granting anon insert here would let anyone holding the anon key
-- — which ships in the browser bundle — write into any client's thread.
