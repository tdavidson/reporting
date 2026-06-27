-- Track prompt-cache token counts so per-deal AI cost estimates reflect caching.
-- cache_read_tokens are billed ~0.1x the input rate; cache_creation_tokens
-- ~1.25x. Anthropic reports these separately from input_tokens.
--
-- New columns on an existing table (ai_usage_logs already carries grants + RLS),
-- so no new Data API grants are required.
alter table public.ai_usage_logs
  add column if not exists cache_read_tokens integer not null default 0,
  add column if not exists cache_creation_tokens integer not null default 0;
