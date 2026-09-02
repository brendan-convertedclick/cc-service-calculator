-- 0156_pimms_matches_its_invoices.sql
--
-- Applied 2026-09-02 (name: pimms_matches_its_invoices).
--
-- Pimms bills on two invoices, and with both in hand the picture closes:
-- INV-2586 "Paid Media Optimisation" R2,500, and INV-2588 "Website Hosting &
-- Maintenance" R2,332.75 = R1,139.25 of hosting across seven sites plus
-- R1,193.50 of maintenance checks.
--
--   * The maintenance line is R1,193.50, not the R1,100 Conductor carried, and
--     the invoice states its own hours: "1 hours should suffice for all
--     websites".
--   * Neither invoice has a monthly feedback meeting on it, so the R2,300
--     retainer is not charged. Reversible in one line if a third invoice turns
--     up carrying it.
--   * The R1,139.25 of hosting is revenue with no work behind it and has no
--     Conductor row at all. Left alone deliberately — the same open question as
--     Dovetail's R2,719.39 and Trellidor UK's R2,500.
update public.projects
   set retainer_monthly_fee_cents = 119350,
       retainer_hours_target = 1.00
 where id = '309ac202-604e-4aa8-88d3-22b0ade37660';

update public.projects
   set is_recurring_task = true,
       retainer_monthly_fee_cents = 0,
       revenue_source = 'Not charged'
 where id = 'c8b9dd58-0a69-4119-ac44-3622e55ad498';
