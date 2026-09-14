-- 0164_invoiced_amounts_on_adhoc_work.sql
-- Apply via mcp__cc-supabase__apply_migration (name: invoiced_amounts_on_adhoc_work)
--
-- Lisa, 2026-09-09: "Add invoiced amounts to the Ad Hoc tab … so completed
-- hours can be compared against what was actually charged — this exposes
-- under-billing or overrun risk."
--
-- A retainer already carries the money beside the hours; ad hoc work never did,
-- so the tab could say a client had 11 hours done and nothing at all about what
-- anyone was charged for them. The live example: September's Pimms ad hoc is
-- 2.4h against INV-2599 at R1,625 net — about R677/hour on a book priced at
-- R1,150.
--
-- ON THIS TABLE RATHER THAN A NEW ONE. xero_invoices already is the invoice
-- table — 1,191 rows mirrored from Xero on 2026-07-30. A second one would mean
-- two answers to "what did we bill this client", and reconciling them the day
-- the Xero sync is revived. Manual rows sit alongside the mirrored ones and
-- carry `source = 'manual'`; matching them up later is `invoice_number`.
--
-- NET, NOT VAT-INCLUSIVE, and this is the whole reason for a new column rather
-- than reusing `amount_cents`. The mirrored rows store what Xero calls the
-- total: R2,875 where the invoice reads R2,500 + VAT. `retainer_monthly_fee_cents`
-- is net. Putting those two in one column and then next to Planned and Completed
-- would make every comparison on the page 15% wrong with nothing on screen
-- admitting it — so the net figure gets its own column and the gross one is left
-- exactly as Xero reported it.
--
-- ISSUED, NOT DUE. The table only had `due_date`, and INV-2599 is dated
-- 1 September with a due date of 30 October: attributing by due date files
-- September's work under October. A month's invoiced total is what was ISSUED
-- in it, matching the way completed work is attributed to the month it closed.

alter table public.xero_invoices
  add column if not exists issued_on date,
  add column if not exists amount_net_cents integer,
  add column if not exists source text not null default 'xero',
  add column if not exists kind text not null default 'invoice',
  add column if not exists reference text;

alter table public.xero_invoices
  drop constraint if exists xero_invoices_source_chk,
  add constraint xero_invoices_source_chk check (source in ('xero', 'manual'));

-- An accepted quote is money committed and not yet invoiced — Trellidor's
-- QU-0311 for the Shutter pricing page. It belongs in the comparison (the work
-- is being done against it) but must never be added to invoiced revenue, so it
-- is a kind rather than a flag on an invoice.
alter table public.xero_invoices
  drop constraint if exists xero_invoices_kind_chk,
  add constraint xero_invoices_kind_chk check (kind in ('invoice', 'quote'));

-- A hand-entered row that says neither what it is worth nor when it was issued
-- cannot be counted, and a row that silently counts as nothing is worse than a
-- row that was never added. The mirrored Xero rows are exempt: they predate
-- both columns and are not what this comparison reads.
alter table public.xero_invoices
  drop constraint if exists xero_invoices_manual_complete_chk,
  add constraint xero_invoices_manual_complete_chk
    check (source <> 'manual' or (issued_on is not null and amount_net_cents is not null));

comment on column public.xero_invoices.amount_net_cents is
  'Ex-VAT, in cents. The basis the Retainers page compares on — retainer fees are net too. `amount_cents` is Xero''s VAT-inclusive total and is left alone.';
comment on column public.xero_invoices.issued_on is
  'The date on the document. A month''s invoiced total is what was ISSUED in it; due_date would file a 1 September invoice under its October due date.';
comment on column public.xero_invoices.kind is
  'invoice = billed. quote = accepted and not yet invoiced; committed money, counted separately so it never inflates revenue.';
