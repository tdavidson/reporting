ALTER TABLE fund_settings
  ADD COLUMN IF NOT EXISTS analytics_fathom_site_id text,
  ADD COLUMN IF NOT EXISTS analytics_ga_measurement_id text,
  ADD COLUMN IF NOT EXISTS analytics_custom_head_script text;
