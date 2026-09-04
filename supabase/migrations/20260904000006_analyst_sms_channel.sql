-- Text the Analyst: an SMS / iMessage channel into the shared Analyst service.
--
-- A fund member links their mobile number once (a code is texted to it and typed back into
-- Settings), and from then on a text to the fund's number is an Analyst turn — the same
-- orchestrator, the same live access resolution, the same conversation store as the web panel
-- and /api/v1/chat. The phone number is the credential here, which is why nothing below is
-- reachable from a browser: a row in analyst_phone_numbers says "this number IS this user", and
-- a verification hash is a credential in flight.
--
-- The provider is Twilio to start (`sms_provider` is a check constraint, not an enum, so a second
-- provider is one more arm). iMessage: an iPhone texting a Twilio long code lands in the Messages
-- app as an ordinary SMS conversation; a blue-bubble bridge (Sendblue, LoopMessage) would be
-- another provider behind the same tables and the same handler.
--
-- See lib/messaging/ and app/api/webhooks/sms/twilio/route.ts.

-- ---------------------------------------------------------------------------
-- FUND_SETTINGS — the fund's provider configuration
-- ---------------------------------------------------------------------------
--
-- Per fund, like the Mailgun inbound settings: the inbound webhook resolves the fund from the
-- number that was texted (`sms_from_number`, E.164), then verifies Twilio's signature with THAT
-- fund's auth token. The token is encrypted under the fund's DEK exactly as every other API key
-- in this table is (see the Mailgun signing key in app/api/settings/route.ts).

alter table public.fund_settings
  add column if not exists sms_provider text
    check (sms_provider is null or sms_provider in ('twilio')),
  add column if not exists sms_from_number text,
  add column if not exists twilio_account_sid text,
  add column if not exists twilio_auth_token_encrypted text;

comment on column public.fund_settings.sms_from_number is
  'The number members text, in E.164. The inbound webhook resolves the fund from it; the app sends replies from it.';
comment on column public.fund_settings.twilio_auth_token_encrypted is
  'Twilio auth token, encrypted under the fund DEK. Verifies inbound webhook signatures and authenticates outbound sends.';

-- One fund per number: two funds claiming the same inbound number would make the webhook's fund
-- lookup ambiguous, and an ambiguous credential check is no check.
create unique index if not exists fund_settings_sms_from_number_idx
  on public.fund_settings (sms_from_number)
  where sms_from_number is not null;

-- ---------------------------------------------------------------------------
-- ANALYST_PHONE_NUMBERS — a member's linked mobile number
-- ---------------------------------------------------------------------------
--
-- One row per member (unique on user_id). Linking is two steps: the row is created with a
-- verification hash and the code is texted to the number; `verified_at` is set when the code comes
-- back through Settings. Until then the number is worth nothing — the webhook only honours rows
-- with `verified_at`, and a number can be verified by ONE user at a time (partial unique index).
--
-- `conversation_id` is the member's current SMS thread in analyst_conversations, so a text
-- continues where the last one left off. It is reset by texting "new", or after a quiet period
-- (lib/messaging/analyst-sms.ts), and `on delete set null` keeps a deleted conversation from
-- stranding the channel.

create table public.analyst_phone_numbers (
  id                        uuid primary key default gen_random_uuid(),
  fund_id                   uuid not null references public.funds(id) on delete cascade,
  user_id                   uuid not null references auth.users(id) on delete cascade,
  -- E.164, e.g. +14155552671. Normalised before it is stored (lib/messaging/phone.ts).
  phone_e164                text not null,
  verified_at               timestamptz,
  -- SHA-256 of the six-digit code; the code itself is never stored. Cleared on verification.
  verification_code_hash    text,
  verification_expires_at   timestamptz,
  verification_attempts     integer not null default 0,
  conversation_id           uuid references public.analyst_conversations(id) on delete set null,
  last_message_at           timestamptz,
  -- Set when the member texts STOP; cleared by START. Twilio enforces the carrier keywords itself
  -- on US numbers, but the app must not keep answering a number that asked it to stop.
  opted_out_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint analyst_phone_numbers_user_key unique (user_id),
  constraint analyst_phone_numbers_e164_check check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

-- A verified number identifies exactly one member. Partial, so two people can be mid-verification
-- on the same number (only one of them has the phone, and only that one will finish).
create unique index analyst_phone_numbers_verified_e164_idx
  on public.analyst_phone_numbers (phone_e164)
  where verified_at is not null;

comment on table public.analyst_phone_numbers is
  'A fund member''s linked mobile number for texting the Analyst. Service-role only: the number is the credential.';

-- 1. Grants — SERVICE ROLE ONLY. The verification hash is a credential in flight and the verified
--    number is a credential at rest; nothing in a browser context ever needs a row. Every read
--    goes through a route holding the service-role key (app/api/settings/phone, the webhook).
revoke all on public.analyst_phone_numbers from anon, authenticated;
grant select, insert, update, delete on public.analyst_phone_numbers to service_role;

-- 2. RLS, with no policies: belt and braces behind the absent grants, so a grant added by mistake
--    still reads nothing.
alter table public.analyst_phone_numbers enable row level security;

-- ---------------------------------------------------------------------------
-- ANALYST_PHONE_MESSAGES — the delivery log
-- ---------------------------------------------------------------------------
--
-- One row per message in either direction. Two jobs: idempotency — Twilio retries a webhook it
-- did not get a timely 2xx for, and `(provider, provider_message_id)` makes the second delivery
-- a no-op — and an audit trail of what was texted from a number that is, after all, a credential.
-- The conversation itself lives in analyst_conversations like every other Analyst thread; the
-- body here is capped and exists for the operator reading a delivery failure.

create table public.analyst_phone_messages (
  id                    uuid primary key default gen_random_uuid(),
  fund_id               uuid not null references public.funds(id) on delete cascade,
  phone_number_id       uuid references public.analyst_phone_numbers(id) on delete set null,
  direction             text not null check (direction in ('inbound', 'outbound')),
  provider              text not null,
  -- Twilio's MessageSid for an inbound message or a sent one; null for a send that never got one.
  provider_message_id   text,
  -- The other party's number; the fund's own number is on fund_settings.
  phone_e164            text not null,
  body                  text not null,
  -- 'received' | 'sent' | 'failed' | 'ignored' — what happened to it, for the log.
  status                text not null,
  error                 text,
  conversation_id       uuid references public.analyst_conversations(id) on delete set null,
  created_at            timestamptz not null default now()
);

create unique index analyst_phone_messages_provider_id_idx
  on public.analyst_phone_messages (provider, provider_message_id)
  where provider_message_id is not null;

create index analyst_phone_messages_fund_created_idx
  on public.analyst_phone_messages (fund_id, created_at desc);

comment on table public.analyst_phone_messages is
  'Inbound and outbound texts to the Analyst. Idempotency key for webhook retries and the delivery log. Service-role only.';

revoke all on public.analyst_phone_messages from anon, authenticated;
grant select, insert, update, delete on public.analyst_phone_messages to service_role;
alter table public.analyst_phone_messages enable row level security;
