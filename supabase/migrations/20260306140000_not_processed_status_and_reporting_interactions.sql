-- Add 'not_processed' to inbound_emails processing_status
ALTER TABLE inbound_emails DROP CONSTRAINT IF EXISTS inbound_emails_processing_status_check;
ALTER TABLE inbound_emails ADD CONSTRAINT inbound_emails_processing_status_check
  CHECK (processing_status IN ('pending', 'processing', 'success', 'failed', 'needs_review', 'not_processed'));

-- Add 'reporting' to interactions type and add topics column
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_type_check;
ALTER TABLE interactions ADD CONSTRAINT interactions_type_check
  CHECK (type IN ('email', 'intro', 'reporting'));

ALTER TABLE interactions ADD COLUMN IF NOT EXISTS topics text[] DEFAULT '{}';
