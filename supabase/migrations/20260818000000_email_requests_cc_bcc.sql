-- Cc/Bcc for reporting-request emails.
--
-- The composer pre-fills from the last sent request so a quarterly ask does not have to be
-- retyped. Subject and body already came back that way; the copy lists did not, because they
-- were never stored — Cc went straight to the provider and was forgotten. These columns hold
-- the normalized list actually sent (comma-separated, as handed to the provider), which makes
-- them both the audit record of who was copied and the value the composer restores.
--
-- Both nullable: a request with no Cc/Bcc is the common case.
alter table public.email_requests
  add column if not exists cc  text,
  add column if not exists bcc text;

comment on column public.email_requests.cc  is 'Normalized Cc list copied on every email in this send (comma-separated).';
comment on column public.email_requests.bcc is 'Normalized Bcc list blind-copied on every email in this send (comma-separated).';

-- No grants block: this is an ALTER on an existing table, and table-level grants already
-- issued to anon/authenticated/service_role cover columns added later. RLS and the existing
-- "Fund members can manage email_requests" policy are unchanged.
