-- Add encrypted column for global inbound token.
-- The plaintext global_inbound_token column is kept for migration but should
-- be cleared once the encrypted value is populated.

alter table app_settings
  add column if not exists global_inbound_token_encrypted text;
