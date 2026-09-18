-- 'waived' = "stop chasing this company for this quarter". Distinct from 'na' (not expected to
-- report at all) and from 'no' (the auto-detected default, which is never stored). The
-- ops-reminders follow-up skips waived companies; real metric data still wins over it.
alter table public.ask_response_overrides
  drop constraint if exists ask_response_overrides_status_check;
alter table public.ask_response_overrides
  add constraint ask_response_overrides_status_check
  check (status in ('yes', 'no', 'na', 'waived'));
