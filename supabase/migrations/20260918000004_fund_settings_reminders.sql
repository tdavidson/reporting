-- Operational reminder settings. Off by default so existing installs don't start emailing on
-- deploy. An empty recipient list means "the fund's admins".
alter table public.fund_settings
  add column if not exists reminders_enabled boolean not null default false,
  add column if not exists reminder_recipients text[] not null default '{}',
  add column if not exists asks_send_offset_days int not null default 0;

alter table public.fund_settings drop constraint if exists fund_settings_asks_send_offset_days_check;
alter table public.fund_settings
  add constraint fund_settings_asks_send_offset_days_check
  check (asks_send_offset_days between 0 and 90);
