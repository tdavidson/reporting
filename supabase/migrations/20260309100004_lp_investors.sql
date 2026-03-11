-- LP investors, entities, and investments for investor-level report cards

CREATE TABLE lp_investors (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id     uuid        NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (fund_id, name)
);
CREATE INDEX idx_lp_investors_fund ON lp_investors(fund_id);
ALTER TABLE lp_investors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can read lp_investors"
  ON lp_investors FOR SELECT
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));

CREATE POLICY "Fund admins can manage lp_investors"
  ON lp_investors FOR ALL
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));

CREATE TABLE lp_entities (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id       uuid        NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  investor_id   uuid        NOT NULL REFERENCES lp_investors(id) ON DELETE CASCADE,
  entity_name   text        NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (fund_id, entity_name)
);
CREATE INDEX idx_lp_entities_fund ON lp_entities(fund_id);
CREATE INDEX idx_lp_entities_investor ON lp_entities(investor_id);
ALTER TABLE lp_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can read lp_entities"
  ON lp_entities FOR SELECT
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));

CREATE POLICY "Fund admins can manage lp_entities"
  ON lp_entities FOR ALL
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));

CREATE TABLE lp_investments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id          uuid        NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  entity_id        uuid        NOT NULL REFERENCES lp_entities(id) ON DELETE CASCADE,
  portfolio_group  text        NOT NULL,
  commitment       numeric,
  paid_in_capital  numeric,
  distributions    numeric,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (fund_id, entity_id, portfolio_group)
);
CREATE INDEX idx_lp_investments_fund ON lp_investments(fund_id);
CREATE INDEX idx_lp_investments_entity ON lp_investments(entity_id);
ALTER TABLE lp_investments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can read lp_investments"
  ON lp_investments FOR SELECT
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));

CREATE POLICY "Fund admins can manage lp_investments"
  ON lp_investments FOR ALL
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));
