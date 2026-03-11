-- LP snapshots: a point-in-time report of investor positions
CREATE TABLE IF NOT EXISTS lp_snapshots (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id     uuid        NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  as_of_date  date,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (fund_id, name)
);
CREATE INDEX IF NOT EXISTS idx_lp_snapshots_fund ON lp_snapshots(fund_id);
ALTER TABLE lp_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can read lp_snapshots"
  ON lp_snapshots FOR SELECT
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));

CREATE POLICY "Fund admins can manage lp_snapshots"
  ON lp_snapshots FOR ALL
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));

-- Add metric columns and snapshot reference to lp_investments
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS total_value numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS nav numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS called_capital numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS outstanding_balance numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS dpi numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS rvpi numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS tvpi numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS irr numeric;
ALTER TABLE lp_investments ADD COLUMN IF NOT EXISTS snapshot_id uuid REFERENCES lp_snapshots(id) ON DELETE CASCADE;

-- Update unique constraint: investments are unique per snapshot
ALTER TABLE lp_investments DROP CONSTRAINT IF EXISTS lp_investments_fund_id_entity_id_portfolio_group_key;
ALTER TABLE lp_investments ADD CONSTRAINT lp_investments_fund_entity_group_snapshot_key
  UNIQUE (fund_id, entity_id, portfolio_group, snapshot_id);

CREATE INDEX IF NOT EXISTS idx_lp_investments_snapshot ON lp_investments(snapshot_id);
