-- Convert contact_email from text to text[]
ALTER TABLE companies
  ALTER COLUMN contact_email TYPE text[]
  USING CASE WHEN contact_email IS NOT NULL THEN ARRAY[contact_email] ELSE NULL END;
