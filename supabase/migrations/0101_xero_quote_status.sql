-- 0101_xero_quote_status.sql
--
-- Phase 1 of the Xero time->money connection: pull a pushed quote's live
-- status back from Xero (DRAFT/SENT/ACCEPTED/DECLINED/INVOICED/DELETED), and
-- best-effort link the resulting Xero invoice back to the quote that spawned
-- it. Xero has no native Quote->Invoice FK, so the link is a heuristic
-- (same client + closest amount) and its confidence is recorded rather than
-- asserted as certain.

alter table quotes add column if not exists xero_quote_status text;
alter table quotes add column if not exists xero_quote_number text;

comment on column quotes.xero_quote_status is
  'Live Status pulled from the Xero Quote (DRAFT/SENT/ACCEPTED/DECLINED/INVOICED/DELETED). Refreshed by xero-sync-quotes.';
comment on column quotes.xero_quote_number is
  'Xero QuoteNumber, for cross-referencing against Xero UI/reports.';

alter table xero_invoices add column if not exists quote_id uuid references quotes(id);
alter table xero_invoices add column if not exists quote_match_confidence text;

comment on column xero_invoices.quote_id is
  'Best-effort link to the Conductor quote this invoice likely originated from. Xero has no native Quote->Invoice reference — see quote_match_confidence.';
comment on column xero_invoices.quote_match_confidence is
  'How quote_id was determined: exact_amount (same client, amount matches to the cent) or closest_amount (same client, nearest amount within tolerance). Null if unmatched.';
