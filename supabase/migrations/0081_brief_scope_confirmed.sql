-- 0081_brief_scope_confirmed.sql
-- Stage-1 gate for the 3-stage brief flow (/briefs/:id/scope).
-- scope_confirmed_at marks that the operator has reviewed and confirmed the
-- in/out-of-scope disposition (ScopeReceipt) before the brief can be approved.
-- Nullable: null = not yet confirmed. scope_confirmed_by mirrors locked_by on
-- scopes (nullable under the shared team@ login with no team_members row).

alter table public.briefs
  add column if not exists scope_confirmed_at timestamptz,
  add column if not exists scope_confirmed_by uuid references public.team_members(id);

comment on column public.briefs.scope_confirmed_at is
  'When the in/out-of-scope disposition (Stage 1) was confirmed. Gates brief approval.';
