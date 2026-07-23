-- Drop the lp_associates_overrides table.
--
-- This was the OLD associates look-through model: per (investor_entity, associates_entity)
-- it stored a free-text ownership_pct / carried_interest_pct that had to match an investor's
-- name AND a portfolio_group string simultaneously — rename anything and it silently stopped
-- matching. It was superseded by the live look-through in lib/accounting/look-through.ts, which
-- derives ownership from the ledger and keys off vehicle_gp_links (ids, not free text).
--
-- The application code that read/wrote this table (the `lp_associates` feature, the
-- /api/lps/associates-calculate and /api/lps/associates-overrides routes) has been removed. This
-- drop retires the now-orphaned table. Dropping the table also drops its index and RLS policies.

drop table if exists public.lp_associates_overrides;
