-- Phase 6 polish: cost caps + per-stage provider overrides for the Memo Agent.

alter table fund_settings
  add column if not exists memo_agent_per_deal_token_cap   bigint,
  add column if not exists memo_agent_monthly_token_cap    bigint,
  -- jsonb mapping stage name → { provider, model } override
  -- e.g. { "ingest": { "provider": "gemini", "model": "gemini-2.0-flash" }, "draft": null }
  add column if not exists memo_agent_stage_models         jsonb default '{}'::jsonb;
