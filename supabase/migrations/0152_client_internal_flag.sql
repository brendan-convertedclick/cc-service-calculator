-- 0152_client_internal_flag.sql
--
-- Applied 2026-09-02 (name: client_internal_flag).
--
-- Client work vs our own work.
--
-- Lisa, 2026-08-27: "I'd like to be able to classify in the Retainers page
-- between client and internal work... internal, you can keep the revenue -
-- worth having a view of it for management."
--
-- The distinction already existed, as a hardcoded list of six client names in
-- useRetainerAllocation.ts. That list was wrong twice over — it was missing
-- Pebble and The Media Mixology, so their work was counted in the client book,
-- and nobody could see or change it without a deploy. It is a fact about the
-- client (all of these are our own brands), so it belongs on the client.
--
-- Revenue is deliberately NOT zeroed: an internal retainer keeps its fee so
-- management can see what our own work would have been worth. The split is
-- reporting, not accounting.
alter table public.clients
  add column if not exists is_internal boolean not null default false;

comment on column public.clients.is_internal is
  'Our own brands and internal work, not a paying client. Reporting keeps the fee but totals these separately — see the Retainers page.';

update public.clients set is_internal = true
 where name in (
   'The Converted Click', 'The Conductor', 'Test Conductor', 'Granite',
   'Quartz', 'Slate', 'Flint', 'Pebble', 'The Media Mixology'
 );

-- RLS: none to add. clients already carries its own policies and this is just
-- another column on it.
