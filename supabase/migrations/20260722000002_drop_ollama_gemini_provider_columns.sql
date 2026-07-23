-- Drop the Ollama and Gemini AI-provider columns.
--
-- Ollama has been removed as a supported AI provider (Anthropic, OpenAI, and OpenRouter remain).
-- Gemini was removed earlier as a soft removal that left its columns behind; this drops them too
-- for parity, since no application code reads or writes either provider's settings any more.
--
-- Both column sets were added by 20260306100000_gemini_ollama.sql (do not edit that historical file).

-- 1. Reset any fund still pointing default_ai_provider at a now-removed provider so it resolves to
--    the app default (anthropic) explicitly, rather than falling through implicitly.
update public.fund_settings
  set default_ai_provider = 'anthropic'
  where default_ai_provider in ('ollama', 'gemini');

-- 2. Drop the dead provider-config columns.
alter table public.fund_settings drop column if exists ollama_base_url;
alter table public.fund_settings drop column if exists ollama_model;
alter table public.fund_settings drop column if exists gemini_api_key_encrypted;
alter table public.fund_settings drop column if exists gemini_model;
