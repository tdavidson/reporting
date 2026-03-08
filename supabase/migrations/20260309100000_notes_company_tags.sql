-- Add company and group tagging to notes
ALTER TABLE company_notes ADD COLUMN IF NOT EXISTS mentioned_company_ids uuid[] DEFAULT '{}';
ALTER TABLE company_notes ADD COLUMN IF NOT EXISTS mentioned_groups text[] DEFAULT '{}';

-- Index for filtering notes by mentioned company
CREATE INDEX IF NOT EXISTS idx_company_notes_mentioned_companies
  ON company_notes USING gin(mentioned_company_ids);
