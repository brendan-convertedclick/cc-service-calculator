-- Line-item specifics on cost estimates: carried from the scope line's
-- description into the CE, rendered on the PDF and in the client email.
ALTER TABLE change_estimate_line_items
  ADD COLUMN IF NOT EXISTS detail text;
