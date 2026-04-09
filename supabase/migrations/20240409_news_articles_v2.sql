-- ============================================================
-- Migration: news_articles v2
-- Run this in your Supabase SQL editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Create table if it doesn't exist
create table if not exists public.news_articles (
  id             uuid primary key default gen_random_uuid(),
  fund_id        uuid not null references public.funds(id) on delete cascade,
  company_id     uuid references public.companies(id) on delete set null,
  company_name   text not null,
  title          text not null,
  link           text not null,
  pub_date       timestamptz not null,
  source         text not null default '',
  source_domain  text not null default '',
  category       text not null default 'outro',
  is_duplicate   boolean not null default false,
  duplicate_of   uuid references public.news_articles(id) on delete set null,
  scraped_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- 2. Add missing columns safely (idempotent)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='news_articles' and column_name='is_duplicate') then
    alter table public.news_articles add column is_duplicate boolean not null default false;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='news_articles' and column_name='duplicate_of') then
    alter table public.news_articles add column duplicate_of uuid references public.news_articles(id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='news_articles' and column_name='scraped_at') then
    alter table public.news_articles add column scraped_at timestamptz not null default now();
  end if;
end $$;

-- 3. Unique constraint (prevents exact duplicate links per fund)
alter table public.news_articles
  drop constraint if exists news_articles_fund_id_link_key;
alter table public.news_articles
  add constraint news_articles_fund_id_link_key unique (fund_id, link);

-- 4. Performance indexes
create index if not exists news_articles_fund_pub_date_idx
  on public.news_articles (fund_id, pub_date desc);

create index if not exists news_articles_fund_company_idx
  on public.news_articles (fund_id, company_id);

create index if not exists news_articles_is_duplicate_idx
  on public.news_articles (fund_id, is_duplicate)
  where is_duplicate = false;

-- 5. Row Level Security
alter table public.news_articles enable row level security;

-- Policy: fund members can read their fund's articles
create policy if not exists "fund members read news" on public.news_articles
  for select using (
    exists (
      select 1 from public.fund_members fm
      where fm.fund_id = news_articles.fund_id
        and fm.user_id = auth.uid()
    )
  );

-- Policy: service role (API) can insert/update/delete
create policy if not exists "service role write news" on public.news_articles
  for all using (true)
  with check (true);
-- Note: in production, scope this to a specific service role or API key
