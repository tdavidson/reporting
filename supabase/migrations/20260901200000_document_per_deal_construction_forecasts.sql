-- Forecast methods now live per deal in the existing JSON assumption columns. Keep the legacy
-- global column for migration-history compatibility; new application code does not read it.

comment on column public.fund_construction_models.return_forecast_method is
  'Legacy global forecast method retained for compatibility; current forecasts select a method per deal.';

comment on column public.fund_construction_models.position_forecasts is
  '[{ companyId, plannedFollowOn, ownershipAtExit, additionalDilution, expectedExitValue, forecastMoic, returnMethod }]';

comment on column public.fund_construction_models.stages is
  '[{ key, label, initialCheck, initialPostMoney, followOnMultiple, followOnCheck, dilutionFactor, ownershipAtExit, additionalDilution, expectedExitValue, forecastMoic, returnMethod }]';
