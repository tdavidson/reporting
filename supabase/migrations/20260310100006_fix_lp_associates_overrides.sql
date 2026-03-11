-- Fix lp_associates_overrides: migrate from old schema (snapshot-scoped with portfolio_group)
-- to new schema (fund-level with investor_entity)

-- Add the missing investor_entity column
ALTER TABLE lp_associates_overrides ADD COLUMN IF NOT EXISTS investor_entity text;

-- Drop old columns that are no longer used
ALTER TABLE lp_associates_overrides DROP COLUMN IF EXISTS snapshot_id;
ALTER TABLE lp_associates_overrides DROP COLUMN IF EXISTS portfolio_group;

-- Make investor_entity NOT NULL (no existing data should be affected since old rows
-- won't have investor_entity set — clear them out first)
DELETE FROM lp_associates_overrides WHERE investor_entity IS NULL;
ALTER TABLE lp_associates_overrides ALTER COLUMN investor_entity SET NOT NULL;

-- Drop old unique constraint and add the new one
ALTER TABLE lp_associates_overrides DROP CONSTRAINT IF EXISTS lp_associates_overrides_fund_id_associates_entity_portfolio_key;
ALTER TABLE lp_associates_overrides DROP CONSTRAINT IF EXISTS lp_associates_overrides_fund_id_investor_entity_associates_key;

-- Add new unique constraint
ALTER TABLE lp_associates_overrides
  ADD CONSTRAINT lp_associates_overrides_fund_id_investor_entity_associates_key
  UNIQUE (fund_id, investor_entity, associates_entity);
