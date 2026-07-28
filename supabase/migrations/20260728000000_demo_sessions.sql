-- Demo starts, recorded server-side.
--
-- The demo signs an anonymous visitor into a shared read-only account, so there is no
-- per-visitor identity to attribute anything to and nothing here is fund-scoped. What
-- this answers is "how many demos started, from where, when" — nothing about who.
--
-- Deliberately NOT stored: IP (raw or hashed), user agent, session id, anything a
-- person could be picked out of. That is a design decision, not an omission: a table
-- holding no personal data has no retention policy to get wrong and no subject-access
-- request to answer. The cost is that unique visitors and repeat abusers are
-- invisible here — abuse is handled by the rate limiter and BotId at the entry point,
-- not by analysing this log.
--
-- `referrer` is safe to keep because the app already sends
-- `Referrer-Policy: strict-origin-when-cross-origin` (next.config.mjs), so a
-- cross-origin referrer arrives as a bare origin — https://news.ycombinator.com/ —
-- never a path or query string. `country` comes from Vercel's geo header and is
-- country-level only.

create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  referrer text,
  country text
);

create index idx_demo_sessions_started on public.demo_sessions (started_at desc);

-- 1. Grants — service_role ONLY, and that is the whole access model.
--    The demo server action is the sole writer. Demo visitors hold a real
--    `authenticated` session, so granting that role would let the people being
--    recorded read the record. No anon, no authenticated — by decision.
grant select, insert on public.demo_sessions to service_role;

-- 2. RLS — on, per the schema-wide default posture.
alter table public.demo_sessions enable row level security;

-- 3. Policies — none, intentionally. service_role bypasses RLS, and no other role
--    holds a grant, so there is no role left to write a policy for. RLS stays enabled
--    so that a future grant added without thinking still hits a closed door.
