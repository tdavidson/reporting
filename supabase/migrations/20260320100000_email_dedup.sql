-- Add deduplication fields to inbound_emails.
-- email_fingerprint is a hash of (fund_id, from_address, subject, original date)
-- to catch the same email forwarded by multiple people.
alter table inbound_emails
  add column if not exists email_fingerprint text;

create index if not exists idx_inbound_emails_fingerprint
  on inbound_emails (fund_id, email_fingerprint)
  where email_fingerprint is not null;
