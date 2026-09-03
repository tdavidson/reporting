-- SEC-010: give each transcription callback its own credential.
--
-- RENAMED from 20260903120000. That version was taken twice — by this file and by
-- 20260903120000_company_updates_lifecycle_search.sql, written the same day in parallel work.
-- Supabase keys `supabase_migrations.schema_migrations` on the version string, so a FRESH install
-- would record the first of the two and silently skip the second: the schema you get depends on
-- which filename sorts first, which is not a property anyone should rely on. Both had already run
-- on the live database, so this rename is a no-op there — every statement below is idempotent, and
-- the next push simply records it under a version of its own.
--
-- The Deepgram callback URL carried ONE shared secret, in the path:
--
--   https://…/api/webhooks/transcription/<TRANSCRIPTION_WEBHOOK_SECRET>
--
-- Two problems, and the path is the smaller one. A URL path is copied into reverse-proxy access
-- logs, tracing spans, error reports and browser history by default, so the secret ends up in
-- places nobody chose to put it. And because it is shared, whoever reads it out of a log can write
-- transcript content to ANY job whose id they can guess — the route's own comment said so.
--
-- Deepgram does not sign prerecorded callbacks, so there is no provider signature to switch to.
-- What we can do without the provider's help is stop reusing one credential: mint a random token
-- per job, store only its hash, and put that in the callback URL. A token then names exactly one
-- job, proves the caller was told about that job, and is cleared the moment the callback lands. A
-- leaked URL is worth one already-finished job instead of the whole endpoint.
--
-- See lib/transcription/callback-token.ts and app/api/webhooks/transcription/[token]/route.ts.

alter table public.memo_agent_jobs
  add column if not exists callback_token_hash text;

-- Unique so a lookup by token cannot be ambiguous, partial so the many jobs with no callback (and
-- the ones whose token has been consumed) do not collide on null.
create unique index if not exists memo_agent_jobs_callback_token_idx
  on public.memo_agent_jobs (callback_token_hash)
  where callback_token_hash is not null;

comment on column public.memo_agent_jobs.callback_token_hash is
  'SHA-256 of the single-use token in this job''s transcription callback URL. Cleared once the callback is processed. See SEC-010.';

-- No grants: memo_agent_jobs is service-role only (20260509000002_memo_agent_jobs_lockdown.sql),
-- and a column holding a credential hash is exactly what should stay that way.
