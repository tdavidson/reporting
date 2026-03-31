-- Fix: add all columns required by VCDeal type to vc_deals_pending
-- The original migration (20260331000001) only created id, fund_id, raw_data,
-- status, extraction_error, created_at, updated_at.
-- All columns below are defined in lib/vc-market/types.ts → VCDeal.

ALTER TABLE public.vc_deals_pending
  ADD COLUMN IF NOT EXISTS user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_name  text,
  ADD COLUMN IF NOT EXISTS amount_usd    numeric,
  ADD COLUMN IF NOT EXISTS deal_date     date,
  ADD COLUMN IF NOT EXISTS stage         text,
  ADD COLUMN IF NOT EXISTS investors     text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS segment       text,
  ADD COLUMN IF NOT EXISTS country       text,
  ADD COLUMN IF NOT EXISTS source_url    text,
  ADD COLUMN IF NOT EXISTS source        text    NOT NULL DEFAULT 'scrape'
                                         CHECK (source IN ('scrape', 'import', 'manual'));

-- Reload PostgREST schema cache immediately (no restart needed)
NOTIFY pgrst, 'reload schema';
