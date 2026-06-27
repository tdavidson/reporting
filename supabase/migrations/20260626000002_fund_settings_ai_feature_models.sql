-- Per-feature AI model overrides for the non-memo-agent features (deals email
-- classifier, deal screening/analysis, inbound portfolio extraction). Mirrors
-- memo_agent_stage_models: a JSONB map of feature -> { provider?, model? }.
-- A missing/null entry means "use the fund default provider + model".
--
-- New column on an existing table (fund_settings already carries grants + RLS),
-- so no new Data API grants are required.
alter table public.fund_settings
  add column if not exists ai_feature_models jsonb default '{}'::jsonb;
