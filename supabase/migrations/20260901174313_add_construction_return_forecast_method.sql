-- One return-forecast method applies to every existing and planned company in a vehicle's
-- construction model. Per-company MOIC inputs live alongside the existing ownership/exit inputs
-- in the validated JSON payloads, so switching methods never discards the other scenario.

alter table public.fund_construction_models
  add column return_forecast_method text not null default 'ownership'
  check (return_forecast_method in ('ownership', 'moic'));

comment on column public.fund_construction_models.return_forecast_method is
  'Global portfolio return forecast method: ownership x exit value, or direct gross MOIC.';

comment on column public.fund_construction_models.position_forecasts is
  '[{ companyId, plannedFollowOn, ownershipAtExit, expectedExitValue, forecastMoic }]';
