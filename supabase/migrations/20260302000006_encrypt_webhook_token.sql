-- Add encrypted column for postmark_webhook_token
ALTER TABLE fund_settings
  ADD COLUMN IF NOT EXISTS postmark_webhook_token_encrypted text;

-- The plaintext postmark_webhook_token column is kept for now as a fallback.
-- Existing tokens will be migrated to encrypted form on next settings save.
-- Once all tokens are migrated, the plaintext column can be dropped.
