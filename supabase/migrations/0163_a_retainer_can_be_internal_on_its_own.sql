-- 0162_a_retainer_can_be_internal_on_its_own.sql
-- Apply via mcp__cc-supabase__apply_migration (name: a_retainer_can_be_internal_on_its_own)
--
-- Lisa, 2026-09-08: "Like we have on the brief approval, can you also add the
-- option to select whether the work is Internal under the retainers."
--
-- A staff brief has carried its own `is_internal` switch since it was built
-- ("Off = client work · On = internal initiative"). A retainer had no such
-- thing: since 0152 the Internal tab has been driven entirely by
-- `clients.is_internal`, which is a fact about the WHOLE CLIENT. That works for
-- our own brands and cannot express the case it keeps meeting — a real client
-- with a real invoice who also has one line nobody charges for. Trellidor has
-- four of them, ten planned hours a month against no fee: our cost, sitting on
-- a paying client's account, with nowhere to say so.
--
-- One boolean, defaulting false, so nothing that exists today moves.
--
-- It is an OR with the client flag, never a replacement:
--   internal = clients.is_internal OR projects.is_internal
-- A retainer belonging to one of our own brands is our own work whatever this
-- column says, so the column cannot be used to move Pebble's work into the
-- client book. It can only ever move work OUT of it, which is the direction
-- that is safe to be wrong in: the client half of the month is what the agency
-- is judged on, and quietly promoting internal time into it flatters every
-- ratio on the page.

alter table public.projects
  add column if not exists is_internal boolean not null default false;

comment on column public.projects.is_internal is
  'This retainer is our own cost rather than a paying client''s, whatever the client is. OR-ed with clients.is_internal (0152) by every reader — it can move work out of the client book, never into it. The per-retainer twin of staff_briefs.is_internal.';
