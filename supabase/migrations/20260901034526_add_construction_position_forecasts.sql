-- Per-company construction assumptions for holdings already in the portfolio.
--
-- The original model stored only aggregate stage bands for deals not yet made. That left the
-- workbook's first and most useful block — the existing portfolio — out of the page entirely.
-- This ordered JSON list is edited as one unit and keyed by the stable company UUID. The API
-- validates every item before writing it.

alter table public.fund_construction_models
  add column position_forecasts jsonb not null default '[]'::jsonb;

comment on column public.fund_construction_models.position_forecasts is
  '[{ companyId, plannedFollowOn, ownershipAtExit, expectedExitValue }]';
