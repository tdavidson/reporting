-- Allow the 'american' (deal-by-deal) carry kind on vehicle_waterfall_terms.
--
-- American carry takes the GP's share on each WINNING deal's own gain — net of that deal's
-- fully-loaded cost (its cost basis plus the fund expenses allocated to it by capital share) —
-- without netting winners against losers, the way whole-fund ('european') carry does. The accrual
-- logic lives in lib/accounting/carry.ts (carryTarget) and close.ts (accrueCarry); this migration
-- only widens the CHECK so the kind can be persisted.

alter table public.vehicle_waterfall_terms
  drop constraint if exists vehicle_waterfall_terms_kind_check;

alter table public.vehicle_waterfall_terms
  add constraint vehicle_waterfall_terms_kind_check
  check (kind in ('none', 'straight', 'american', 'european'));
