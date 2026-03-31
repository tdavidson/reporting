-- vc_deals_pending: staging table for AI-extracted deals before review/approval
create table if not exists public.vc_deals_pending (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid references public.funds(id) on delete cascade,
  raw_data        jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  extraction_error text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- RLS
alter table public.vc_deals_pending enable row level security;

create policy "fund members can manage vc_deals_pending"
  on public.vc_deals_pending
  for all
  using (
    fund_id in (
      select fund_id from public.fund_members
      where user_id = auth.uid()
    )
  );

-- updated_at trigger (reuse existing helper if present)
create or replace trigger set_updated_at_vc_deals_pending
  before update on public.vc_deals_pending
  for each row execute function public.set_updated_at();
