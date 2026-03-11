-- RLS policies for LP tables (lp_investors, lp_entities, lp_investments, lp_snapshots)
-- These are duplicated from the table-creation migrations as a safety net.
-- Using DO blocks to avoid errors if policies already exist.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Fund members can read lp_investors') THEN
    CREATE POLICY "Fund members can read lp_investors"
      ON lp_investors FOR SELECT
      USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Fund admins can manage lp_investors') THEN
    CREATE POLICY "Fund admins can manage lp_investors"
      ON lp_investors FOR ALL
      USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
      WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Fund members can read lp_entities') THEN
    CREATE POLICY "Fund members can read lp_entities"
      ON lp_entities FOR SELECT
      USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Fund admins can manage lp_entities') THEN
    CREATE POLICY "Fund admins can manage lp_entities"
      ON lp_entities FOR ALL
      USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
      WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Fund members can read lp_investments') THEN
    CREATE POLICY "Fund members can read lp_investments"
      ON lp_investments FOR SELECT
      USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Fund admins can manage lp_investments') THEN
    CREATE POLICY "Fund admins can manage lp_investments"
      ON lp_investments FOR ALL
      USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
      WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Fund members can read lp_snapshots') THEN
    CREATE POLICY "Fund members can read lp_snapshots"
      ON lp_snapshots FOR SELECT
      USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Fund admins can manage lp_snapshots') THEN
    CREATE POLICY "Fund admins can manage lp_snapshots"
      ON lp_snapshots FOR ALL
      USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'))
      WITH CHECK (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
