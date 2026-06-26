-- Tag AI usage with the diligence deal it was spent on, so per-deal token /
-- cost reporting is possible (Settings tab on a deal). Nullable: non-diligence
-- usage (company summaries, email import, etc.) leaves it null.
--
-- New column on an existing table: ai_usage_logs already has Data API grants
-- and RLS (see 20260302000011_ai_usage_logs.sql), which cover this column; no
-- new grants required.
alter table public.ai_usage_logs
  add column if not exists deal_id uuid references diligence_deals(id) on delete set null;

create index if not exists idx_ai_usage_logs_deal on public.ai_usage_logs (deal_id, created_at desc);
