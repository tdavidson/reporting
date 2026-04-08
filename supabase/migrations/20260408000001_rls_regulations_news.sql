-- NEWS_ARTICLES (scoped by fund_id)
alter table public.news_articles enable row level security;

create policy "fund members can read news"
  on public.news_articles for select
  using (
    fund_id in (
      select fund_id from fund_members where user_id = auth.uid()
    )
  );

create policy "service role can write news"
  on public.news_articles for all
  using (auth.role() = 'service_role');

-- REGULATIONS (global table, no fund_id)
alter table public.regulations enable row level security;

create policy "authenticated users can read regulations"
  on public.regulations for select
  using (auth.role() = 'authenticated');

create policy "service role can write regulations"
  on public.regulations for all
  using (auth.role() = 'service_role');
