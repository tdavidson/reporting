-- News sources table
create table if not exists news_sources (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  name text not null,
  url text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists news_sources_fund_id_idx on news_sources(fund_id);

alter table news_sources enable row level security;

create policy "fund members can read news sources"
  on news_sources for select
  using (
    fund_id in (
      select fund_id from fund_members where user_id = auth.uid()
    )
  );

create policy "fund admins can write news sources"
  on news_sources for all
  using (
    fund_id in (
      select fund_id from fund_members where user_id = auth.uid() and role = 'admin'
    )
  );
