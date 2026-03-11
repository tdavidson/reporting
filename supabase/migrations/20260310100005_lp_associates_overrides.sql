-- Associates ownership mapping: which investor entities own shares of Associates entities
-- Fund-level (persists across snapshots)
CREATE TABLE IF NOT EXISTS lp_associates_overrides (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id              uuid        NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  investor_entity      text        NOT NULL,
  associates_entity    text        NOT NULL,
  ownership_pct        numeric,
  carried_interest_pct numeric,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  UNIQUE (fund_id, investor_entity, associates_entity)
);

CREATE INDEX IF NOT EXISTS idx_lp_associates_overrides_fund ON lp_associates_overrides(fund_id);
ALTER TABLE lp_associates_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can read lp_associates_overrides"
  ON lp_associates_overrides FOR SELECT
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));

CREATE POLICY "Fund admins can manage lp_associates_overrides"
  ON lp_associates_overrides FOR ALL
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));
