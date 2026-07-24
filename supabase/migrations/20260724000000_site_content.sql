-- Deployment-level marketing content for the single-page public site. ONE row (id = true).
-- Not fund-scoped: this is the install owner's marketing page, not tenant data.
create table public.site_content (
  id boolean primary key default true,
  content jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  constraint site_content_singleton check (id = true)
);

-- 1. Grants — the public marketing page reads this anonymously, so anon needs SELECT.
--    Writes go through the service-role admin client in /api/settings/site-content.
grant select on public.site_content to anon, authenticated, service_role;
grant insert, update, delete on public.site_content to authenticated, service_role;

-- 2. RLS on (schema-wide default).
alter table public.site_content enable row level security;

-- 3. Policies. Read is public; no anon/authenticated write policy (admin client bypasses RLS).
create policy "Anyone can read site content"
  on public.site_content for select to anon, authenticated using (true);
