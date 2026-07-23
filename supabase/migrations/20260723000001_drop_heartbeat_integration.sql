-- Drop the Heartbeat community integration.
--
-- The Heartbeat integration (community threads -> Deals; see
-- 20260714000009_heartbeat_integration.sql) has been removed from the app: the
-- client/ingest/webhook/cron/settings code and UI are deleted, so the tables
-- and support index behind them are dead weight. This migration drops them.
--
-- intro_source='heartbeat' is INTENTIONALLY KEPT as a legal value in
-- inbound_deals_intro_source_check (see 20260714000009) and in the IntroSource
-- union in lib/types/database.ts. Existing inbound_deals rows ingested through
-- Heartbeat before this removal still carry that value and must remain valid
-- and readable; the constraint is deliberately NOT tightened here. No new rows
-- can be created with this value since the only path that set it
-- (processDeal's introSourceOverride, driven by the Heartbeat ingest) is gone.

drop table if exists public.heartbeat_threads;
drop table if exists public.heartbeat_channels;
drop table if exists public.heartbeat_credentials;

drop index if exists public.inbound_deals_heartbeat_source_idx;
