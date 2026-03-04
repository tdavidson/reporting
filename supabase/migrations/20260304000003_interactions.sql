-- Interactions table for CRM email tracking
CREATE TABLE interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  email_id uuid UNIQUE REFERENCES inbound_emails(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'email' CHECK (type IN ('email', 'intro')),
  subject text,
  summary text,
  intro_contacts jsonb DEFAULT '[]'::jsonb,
  body_preview text,
  interaction_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_interactions_fund_id ON interactions(fund_id);
CREATE INDEX idx_interactions_company_id ON interactions(company_id);
CREATE INDEX idx_interactions_type ON interactions(fund_id, type);

ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view interactions for their fund"
  ON interactions FOR SELECT
  USING (fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid()));

-- Add email_type column to inbound_emails
ALTER TABLE inbound_emails ADD COLUMN email_type text NOT NULL DEFAULT 'metrics';

-- Helper function to check fund membership by email
CREATE OR REPLACE FUNCTION is_fund_member_by_email(p_fund_id uuid, p_email text)
RETURNS TABLE(user_id uuid, member_role text) AS $$
  SELECT fm.user_id, fm.role::text
  FROM fund_members fm
  JOIN auth.users u ON u.id = fm.user_id
  WHERE fm.fund_id = p_fund_id
    AND lower(u.email) = lower(p_email)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
