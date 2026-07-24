-- Saved reports now carry which Reports view they open (invoice | scorecard |
-- delays), so the landing dashboard can label each saved card by its type and
-- restore the right report on load.

alter table public.saved_reports
  add column if not exists report_type text not null default 'scorecard';

comment on column public.saved_reports.report_type is 'Which Reports view this saved report opens: invoice | scorecard | delays.';
