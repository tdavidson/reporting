CREATE TABLE company_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fund members can manage company notes"
  ON company_notes FOR ALL
  USING (fund_id = ANY(public.get_my_fund_ids()));

CREATE INDEX idx_company_notes_company ON company_notes(company_id, created_at DESC);
