-- 0165_a_brief_can_be_internal.sql
-- Apply via mcp__cc-supabase__apply_migration (name: a_brief_can_be_internal)
--
-- Lisa, 2026-09-10: "under Billing can we have a Internal option so it's not
-- just Retainer Or Adhoc".
--
-- Until now "internal" was a fact about the CLIENT (clients.is_internal, 0152)
-- — our own brands — so the only way to mark a piece of work as our own cost
-- was for the whole client to be ours. Work we absorb for a PAYING client had
-- nowhere to go: it was booked adhoc, which says we invoiced it, or retainer,
-- which says a fee covered it. Both are wrong, and both overstate what the
-- client was billed.
--
-- This is the brief-level twin of projects.is_internal (0162), and every reader
-- combines it the same way: internal if the client is one of ours OR the work
-- itself was marked internal. It can only ever move work OUT of the billable
-- book, never into it.
--
-- approve-staff-brief already declared `billing?: "retainer" | "adhoc" |
-- "internal"` and then coerced it — `destination === "retainer" ? "retainer" :
-- "adhoc"` — because the constraint refused the third value. So internal staff
-- briefs have been landing as adhoc all along; that line can now say what it
-- means.
--
-- get-invoice-report filters on billing_type = 'adhoc' and therefore excludes
-- internal work automatically, which is right: we do not invoice ourselves.

alter table public.briefs
  drop constraint if exists briefs_billing_type_check;

alter table public.briefs
  add constraint briefs_billing_type_check
    check (billing_type = any (array['retainer'::text, 'adhoc'::text, 'internal'::text]));

comment on column public.briefs.billing_type is
  'retainer = covered by a monthly fee (see parent_project_id). adhoc = invoiced separately. internal = our own cost, absorbed — valid on a paying client, and OR-ed with clients.is_internal by every reader.';
