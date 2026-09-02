-- 0155_retainers_match_the_invoices.sql
--
-- Applied 2026-09-02 (name: retainers_match_the_invoices).
--
-- Lisa, 2026-09-02: "Base the retainers only on the invoice items and cost
-- attached. All other work to move off retainers to recurring."
--
-- Reconciled against the August 2026 invoices: INV-2585 (Kings College),
-- INV-2586 (Pimms), INV-2587 (Dovetail), INV-2589 (Trellidor UK). Every change
-- below is a line that either is not on an invoice at all, or is charged at a
-- different figure from the one Conductor was carrying.
--
-- Dovetail reconciles exactly once these are applied: 3,439.45 + 3,797.50 +
-- 8,137.50 = 15,374.45, which is the invoice less its hosting line. The gap
-- was 4,263.75 = the meeting (2,300) + the ads report (575) + the plugin (575)
-- + the social line counted twice (813.75).

-- ---------------------------------------------------------------------------
-- 1. Monthly feedback meetings that no invoice charges for.
-- ---------------------------------------------------------------------------
-- Dovetail's invoice has no meeting line. Trellidor UK's does not either — its
-- R30,000 Business Plan line already lists "Monthly Feedback Sessions", so a
-- separate R2,300 retainer was charging for it twice. Kings College's meeting
-- IS inside its single R24,500 line and its two Conductor rows sum to exactly
-- that, so it is left alone.
update public.projects
   set is_recurring_task = true,
       retainer_monthly_fee_cents = 0,
       revenue_source = case
         when id = 'ada381b8-a970-4372-8bdd-7333ffa8d748'
           then 'Included in the Business Plan line'
         else 'Not charged'
       end
 where id in (
   '307ccb09-ee86-4f2e-8b86-9497bcbae977', -- Dovetail RSA Monthly Feedback Meeting
   'ada381b8-a970-4372-8bdd-7333ffa8d748'  -- Trellidor UK Monthly Feedback Meeting
 );

-- ---------------------------------------------------------------------------
-- 2. Dovetail's social posts were being charged twice.
-- ---------------------------------------------------------------------------
-- "Content & Social" carried 3,439.45, which is exactly the invoice's blog
-- article line (2,625.70) PLUS its organic social line (813.75) — and the
-- social line is also its own retainer. Each Conductor row is now one invoice
-- line. The name should follow the money and become "Blog Articles"; left for
-- Lisa, because renaming touches what the provisioner calls its ClickUp tasks.
update public.projects
   set retainer_monthly_fee_cents = 262570,
       retainer_hours_target = 2.28
 where id = '1d17f351-9bbd-4240-94a9-88b921b89d8d';

-- ---------------------------------------------------------------------------
-- 3. Planned hours that did not follow their own fee.
-- ---------------------------------------------------------------------------
-- Every retainer in the book is fee / R1,150. These two were not, and both
-- invoices confirm the fee is the right side of the discrepancy: Trellidor UK's
-- Business Plan is R30,000 (26.09h, not 24.09 — a 4-for-6 typo), and Kings
-- College's meeting is R2,300 (2.00h, not 2.50, which is what made their two
-- rows add to 21.80h against an invoice of 21.30h).
update public.projects set retainer_hours_target = 26.09
 where id = '4f8f6f15-ae83-4d09-ae8b-46bcdd817fe8';
update public.projects set retainer_hours_target = 2.00
 where id = 'd200a6b9-b88d-4030-b395-b2388d385bc6';
