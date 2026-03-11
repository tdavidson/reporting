-- Add footer_note text field to lp_snapshots for report footer customization
ALTER TABLE lp_snapshots ADD COLUMN IF NOT EXISTS footer_note text;
