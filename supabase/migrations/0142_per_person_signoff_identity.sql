-- 0142_per_person_signoff_identity.sql
-- Apply via mcp__cc-supabase__apply_migration (name: per_person_signoff_identity)
--
-- Makes a client's approval into evidence rather than an assertion.
--
-- Two problems, and only the second one is about identity:
--
--   1. THE LOG POINTED AT A LIVE ROW. `client_title` and `ask` stay editable
--      after someone approves, so changing the wording afterwards silently
--      rewrote what they had agreed to. "They approved this" is worth nothing
--      if "this" can move. decided_title / decided_ask freeze the exact text
--      at the click, and nothing ever updates them again.
--
--   2. ATTRIBUTION WAS SELF-DECLARED. One token covered a whole company, and
--      the page asked "And you are?" — so anyone holding the link could pick
--      any name off that company's contact list. client_review_tokens.
--      contact_id makes the LINK the identity: a token minted for one person
--      resolves to that person server-side, the picker never appears, and the
--      name on the record cannot be chosen by whoever is holding the link.
--
-- Deliberately NOT client accounts. A login wall is the single biggest reason
-- a client never arrives, which is why 0139 captured identity at the decision
-- instead of at the door. This keeps that property and removes the guesswork.
--
-- Backwards compatible: contact_id is nullable, and a company-wide token
-- (every token minted before this migration) still resolves to the old
-- "And you are?" flow.
--
-- Additive only: no DROP, no destructive ALTER.

-- ---------------------------------------------------------------------------
-- 1. contacts gains the composite key a scoped FK needs.
-- ---------------------------------------------------------------------------
-- id is already the primary key, so this is redundant as a uniqueness claim.
-- It exists so client_review_tokens can reference (contact_id, client_id)
-- together — which makes "this person belongs to this client" a database
-- guarantee rather than something every caller has to remember to check.
-- Handing a client a link that signs in as somebody from another company is
-- exactly the failure `weighty` was invented to prevent.
create unique index if not exists contacts_id_client_id_key
  on public.contacts (id, client_id);

-- ---------------------------------------------------------------------------
-- 2. A link can belong to one person.
-- ---------------------------------------------------------------------------
alter table public.client_review_tokens
  add column if not exists contact_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_review_tokens_contact_fkey'
  ) then
    alter table public.client_review_tokens
      add constraint client_review_tokens_contact_fkey
      foreign key (contact_id, client_id)
      references public.contacts (id, client_id)
      on delete cascade;
  end if;
end $$;

comment on column public.client_review_tokens.contact_id is
  'Whose link this is. When set, the review function resolves the signer from the token and IGNORES any identity in the request body — the link is the identity. Null = a legacy company-wide link, which still falls back to the "And you are?" picker.';

-- ---------------------------------------------------------------------------
-- 3. The decision records what was decided, and from where.
-- ---------------------------------------------------------------------------
alter table public.client_approvals
  add column if not exists decided_by_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists decided_title text,
  add column if not exists decided_ask   text,
  add column if not exists decided_ip    text,
  add column if not exists decided_user_agent text;

comment on column public.client_approvals.decided_by_contact_id is
  'The contact the token resolved to, when the link was a personal one. decided_by_name/email stay populated either way — they are the readable record and survive a contact being deleted.';

comment on column public.client_approvals.decided_title is
  'client_title AS IT READ at the moment of the decision. Frozen: never updated afterwards. Editing client_title later must not rewrite what somebody agreed to.';

comment on column public.client_approvals.decided_ask is
  'ask AS IT READ at the moment of the decision. Frozen, for the same reason as decided_title.';

comment on column public.client_approvals.decided_ip is
  'First hop of x-forwarded-for at the decision. Evidence, not identity — it is trivially shared and must never be used to recognise anyone.';
