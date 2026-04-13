-- Tracks every time the regulation scraper runs (cron or manual)
create table if not exists scraper_runs (
  id          uuid        primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  trigger     text        not null check (trigger in ('manual', 'cron')),
  user_id     uuid        references auth.users(id) on delete set null,
  user_email  text,
  year        integer     not null,
  inserted    integer     not null default 0,
  skipped     integer     not null default 0,
  error       text
);

create index if not exists scraper_runs_ran_at_idx on scraper_runs(ran_at desc);

alter table scraper_runs enable row level security;

-- All authenticated users can read scraper runs (visible to everyone in the team)
create policy "authenticated users can read scraper runs"
  on scraper_runs for select
  to authenticated
  using (true);

-- Only service role can insert (done server-side via admin client)
create policy "service role can insert scraper runs"
  on scraper_runs for insert
  to service_role
  with check (true);
