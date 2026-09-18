-- When the construction plan happens, and how its outcomes are spread.
--
-- The construction model deliberately had no time axis: nothing in it said when a check is
-- written or a company exits, so no chart on the page could honestly carry a date. The pacing
-- assumptions state that — deployment period, follow-on lag, hold periods, horizon — and
-- lib/accounting/construction-forecast.ts turns the plan into a yearly schedule with DPI, TVPI
-- and net IRR. The simulation settings (loss rate, dispersion, exit spread, runs, seed) drive
-- lib/accounting/construction-simulation.ts, which samples thousands of outcomes over the same
-- schedule.
--
-- Two jsonb columns rather than a dozen numeric ones: each is a small object edited as a unit and
-- validated at the write boundary (validateConstructionAssumptions). EVERY STRATEGY FIELD DEFAULTS
-- TO ZERO, as the rest of this table does: a zero hold period is a question the page asks, not a
-- fund that exits today. The engine settings (runs, seed) carry their own defaults in code.
alter table public.fund_construction_models
  add column if not exists pacing jsonb not null default '{}'::jsonb,
  add column if not exists simulation jsonb not null default '{}'::jsonb;

comment on column public.fund_construction_models.pacing is
  '{ deploymentYears, followOnLagYears, holdYears, existingHoldYears, horizonYears, accretion } — '
  'parsed by parseAssumptions() in lib/accounting/construction.ts.';
comment on column public.fund_construction_models.simulation is
  '{ runs, seed, lossRate, dispersion, holdSpreadYears, maxMoic, targetMultiple } — parsed by '
  'parseAssumptions() in lib/accounting/construction.ts.';
