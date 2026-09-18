-- Which reminder thresholds have been emailed, per fund. The ops-reminders cron recomputes open
-- items daily and sends a digest only when an item crosses a threshold whose key is not here.
-- Keys embed the due date ("c:form-adv::2027-03-31:t14"), so moving a due date re-arms them.

create table public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  unique (fund_id, key)
);

-- Service role only: the cron is the sole reader and writer. Revoke first — projects created
-- before 2026-05-30 still auto-grant new public tables to anon/authenticated.
revoke all on public.reminder_deliveries from anon, authenticated;
grant select, insert, update, delete on public.reminder_deliveries to service_role;

-- RLS on with no policies: if a grant ever creeps back, every row is still denied.
alter table public.reminder_deliveries enable row level security;
