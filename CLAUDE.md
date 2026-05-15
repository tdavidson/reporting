# Repo conventions for AI assistants

Conventions baked in to keep automated edits safe across this repo. Read before generating migrations or refactoring data-access code.

## Migration conventions

### Every new `create table` migration requires explicit Data API grants

Supabase is moving to an "explicit grants required" model for the Data API. New Supabase projects after 2026-05-30, and all existing projects after 2026-10-30, will create tables in the `public` schema **without** automatic grants to `anon`/`authenticated`/`service_role`. The Data API (supabase-js, PostgREST, GraphQL) can't see those tables until grants are issued explicitly.

This repo is meant to be installable against fresh Supabase projects, so every `create table` migration must include the grants inline. The bulk-backfill migration (`20260513000000_data_api_grants_backfill.sql`) covers tables created before that date — but anything new must carry its own grants or the app breaks on fresh post-2026-05-30 installs.

**Template for any new table:**

```sql
create table public.new_thing (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  -- ... columns ...
  created_at timestamptz not null default now()
);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
--    Default posture: anon = SELECT only (no unauthenticated writes via Data API);
--    authenticated + service_role get full CRUD, with RLS scoping per-row access.
--    Only grant anon writes if the table genuinely needs unauthenticated insert/update.
grant select on public.new_thing to anon;
grant select, insert, update, delete on public.new_thing to authenticated, service_role;

-- 2. RLS — enable even if you think it isn't needed. The schema-wide default is "RLS on".
alter table public.new_thing enable row level security;

-- 3. Policies — at least one per role that should have access. Without policies, RLS
--    blocks every row even when grants are in place.
create policy "Fund members read their fund's rows"
  on public.new_thing for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = new_thing.fund_id and fm.user_id = auth.uid()
  ));
-- (add insert/update/delete policies as the table requires)
```

**Sequences:** this repo uses `uuid default gen_random_uuid()` for primary keys, so explicit sequences are rare. If you ever add one (`bigserial`, `serial`, `create sequence`), add `grant usage, select on sequence public.<name> to anon, authenticated, service_role;` alongside it.

**Functions:** Postgres functions have a separate default-privileges model from tables and are not affected by the 2026 Data API grants rollout. SECURITY DEFINER functions still need `revoke execute from anon, authenticated, public` if you don't want unauthenticated callers (see `20260509000002_memo_agent_jobs_lockdown.sql` for the pattern).

### Don't edit historical migrations

Migration files that have already shipped to production must not be edited. The Supabase CLI tracks applied migrations by filename hash; modifying an applied migration causes integrity failures on re-deploy. Always add a new migration.

### Don't apply migrations remotely via Supabase MCP

This repo's owner runs `supabase db push` themselves. AI assistants only create local migration files in `supabase/migrations/`; they do not apply them.

## Data-access conventions

### Cross-tenant safety

Every API route resolves `fund_id` from `auth.getUser()` → `fund_members` lookup, not from the request body or params. The single-fund-per-user invariant is enforced at the schema level (`fund_members.user_id` is unique — see `20260511000001_fund_members_one_fund_per_user.sql`). If you ever need to break that invariant, the resolution path needs to change too — likely to a session-stored `current_fund_id`.

### Admin client vs user-context client

Most write operations use `createAdminClient()` (service role) with manual `.eq('fund_id', ...)` filters. RLS is in place on most tables as a secondary defense but the dominant security boundary is application code, not RLS. When adding new endpoints, follow the same pattern: admin client for writes, manual fund scoping, RLS policies still recommended for defense in depth.
