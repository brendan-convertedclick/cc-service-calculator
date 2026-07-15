-- Per-line unit price override on quote lines. Null = derive from the
-- services catalogue (existing behavior). Set when a quote is seeded from
-- confirmed scope-receipt placements whose operator-edited price differs
-- from the catalogue sell price.
ALTER TABLE quote_services
  ADD COLUMN IF NOT EXISTS unit_price_override_cents bigint;
