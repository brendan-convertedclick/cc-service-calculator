-- Client-facing cost estimate PDF: separate artefact from sow_pdf_url.
-- Generated on finalise alongside the SOW PDF and stored in the same
-- quote-pdfs bucket under <quote_id>/cost-estimate-v<version>.pdf.

alter table public.quotes
  add column if not exists cost_estimate_pdf_url text;
