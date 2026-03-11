-- Add flag to control associates calculations per snapshot
ALTER TABLE lp_snapshots ADD COLUMN IF NOT EXISTS associates_calc_enabled boolean DEFAULT true;

-- Add input columns to preserve original imported values for auditing.
-- When associates calc runs, it saves the pre-existing values here before overwriting.
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS input_commitment numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS input_paid_in_capital numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS input_distributions numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS input_nav numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS input_total_value numeric;
