-- Add per-metric currency override (null = use fund-level currency)
ALTER TABLE metrics
  ADD COLUMN currency text;
