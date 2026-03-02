ALTER TABLE fund_settings
  ADD COLUMN openai_api_key_encrypted text,
  ADD COLUMN openai_model text NOT NULL DEFAULT 'gpt-4o',
  ADD COLUMN default_ai_provider text NOT NULL DEFAULT 'anthropic';
