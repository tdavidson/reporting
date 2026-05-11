-- Phase 2 of the Deals feature: analyst conversations scoped to deals + public
-- submission token for the founder-facing form.

-- ---------------------------------------------------------------------------
-- analyst_conversations.deal_id
-- ---------------------------------------------------------------------------
-- Conversations may now be scoped to either a company OR a deal (both null
-- means portfolio-wide, the original behavior).

alter table analyst_conversations
  add column if not exists deal_id uuid references inbound_deals(id) on delete cascade;

create index if not exists idx_analyst_conv_user_deal
  on analyst_conversations (user_id, deal_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- fund_settings.deal_submission_token
-- ---------------------------------------------------------------------------
-- Opaque per-fund token. Founders submit pitches via /submit/<token>. Setting
-- it to null disables the public form for that fund.

alter table fund_settings
  add column if not exists deal_submission_token text;

create unique index if not exists fund_settings_deal_submission_token_idx
  on fund_settings (deal_submission_token)
  where deal_submission_token is not null;
