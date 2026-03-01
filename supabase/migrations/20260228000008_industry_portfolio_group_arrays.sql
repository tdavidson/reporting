-- Convert industry from text to text[]
ALTER TABLE companies
  ALTER COLUMN industry TYPE text[]
  USING CASE WHEN industry IS NOT NULL THEN ARRAY[industry] ELSE NULL END;

-- Convert portfolio_group from text to text[]
ALTER TABLE companies
  ALTER COLUMN portfolio_group TYPE text[]
  USING CASE WHEN portfolio_group IS NOT NULL THEN ARRAY[portfolio_group] ELSE NULL END;
