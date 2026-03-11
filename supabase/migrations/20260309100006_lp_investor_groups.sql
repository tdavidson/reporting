-- Add parent_id to lp_investors for grouping investors under a parent
ALTER TABLE lp_investors ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES lp_investors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lp_investors_parent ON lp_investors(parent_id);
