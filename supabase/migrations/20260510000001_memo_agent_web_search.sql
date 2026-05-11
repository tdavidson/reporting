-- Enable Anthropic web search for the Memo Agent's research stage.
-- When true and the research stage runs against an Anthropic provider, the
-- agent gets the `web_search_20250305` tool and is instructed to verify
-- claims against external sources. Web search calls are billed separately
-- by Anthropic (~$10 per 1,000 searches) on top of token usage.

alter table fund_settings
  add column if not exists memo_agent_web_search_enabled boolean not null default false;

comment on column fund_settings.memo_agent_web_search_enabled is
  'If true, the memo agent research stage uses Anthropic web search when the active provider is Anthropic. Adds external billing per Anthropic''s web_search tool pricing.';
