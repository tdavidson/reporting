CREATE TABLE email_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  subject text NOT NULL,
  body_html text NOT NULL,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_by uuid NOT NULL REFERENCES auth.users(id),
  quarter_label text,
  status text NOT NULL DEFAULT 'draft',
  sent_at timestamptz,
  send_results jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fund members can manage email_requests"
  ON email_requests FOR ALL
  USING (fund_id = ANY(public.get_my_fund_ids()));
