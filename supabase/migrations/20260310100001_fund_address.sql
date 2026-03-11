-- Add address/contact text field to funds for investor report pages
ALTER TABLE funds ADD COLUMN IF NOT EXISTS address text;
