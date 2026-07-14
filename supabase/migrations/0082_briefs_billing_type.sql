-- Billing classification on briefs: retainer (in-scope, covered) vs adhoc
-- (out-of-scope, needs quote/invoice). Surfaced as a tag on the Briefs page.

alter table public.briefs add column if not exists billing_type text not null default 'retainer';
alter table public.briefs drop constraint if exists briefs_billing_type_check;
alter table public.briefs add constraint briefs_billing_type_check check (billing_type in ('retainer','adhoc'));

comment on column public.briefs.billing_type is
  'Billing classification: retainer (in-scope, covered by retainer) or adhoc (out-of-scope, needs quote/invoice).';
