-- Maps each department to its Xero chart-of-accounts revenue code, so
-- push-to-xero can set a valid AccountCode on quote/invoice line items.
-- Previously quote_line_item_allocations.xero_code was populated from
-- services.code (an internal SKU, e.g. "004"), which never matched a real
-- Xero account and made every push fail.

alter table departments add column xero_code text;

update departments set xero_code = case name
  when 'Development' then '202'
  when 'SEO' then '207'
  when 'Strategy' then '211'
  when 'Creative Production' then '204'
  when 'Content & Copywriting' then '205'
  when 'Video / 3D / Motion Production' then '203'
  when 'Paid Media' then '208'
  when 'Software / Spend / Pass-Through / Non-Delivery' then '206'
  when 'Project Management' then '210'
  when 'Social Media' then '260'
  else null
end;
