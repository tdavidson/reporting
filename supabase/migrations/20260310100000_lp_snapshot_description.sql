-- Add description text field to lp_snapshots for investor report pages
ALTER TABLE lp_snapshots ADD COLUMN IF NOT EXISTS description text;
