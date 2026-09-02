-- Make `Idempotency-Key` mean something.
--
-- `POST /api/v1/pending-actions/:id/approve` already REQUIRED the header and then ignored it. The
-- action id gave partial protection — the pending-action service claims a row atomically, so a
-- second approval of the same action loses the race and fails — but "fails" is the wrong answer to
-- a retry. A phone on a flaky connection cannot tell a lost response from a lost request, so it
-- retries, and the honest retry of a SUCCESSFUL approval came back as an error about an action
-- that was no longer pending. The client then has to guess whether it moved money.
--
-- So the response is stored under the key and replayed. A retry with the same key gets the same
-- body and status it would have got the first time; a DIFFERENT request sent under a key that has
-- already been used is refused rather than executed, because that is a client bug and executing it
-- would be the expensive kind.
--
-- Scoped to (fund, client, endpoint, key): one native app's keys cannot collide with another's,
-- and a key is not portable between endpoints.

create table public.api_idempotency_keys (
  fund_id      uuid        not null references funds(id) on delete cascade,
  client_id    text        not null,
  endpoint     text        not null,
  key          text        not null,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  -- What was asked. A second request under the same key that hashes differently is a mistake, not
  -- a retry, and gets 409 rather than an execution.
  fingerprint  text        not null,
  status       text        not null default 'in_progress'
                 check (status in ('in_progress', 'completed')),
  -- The stored response, replayed verbatim on a retry.
  response_status int,
  response_body   jsonb,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  primary key (fund_id, client_id, endpoint, key)
);

-- Retention: a key is only useful for as long as a client might retry. Sweeping is left to the
-- caller of `expire_api_idempotency_keys()` (cron or a maintenance route) rather than a trigger,
-- so a slow delete can never sit inside a request that is trying to approve a capital call.
create index api_idempotency_keys_created_idx on public.api_idempotency_keys (created_at);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
--    This one is service-role ONLY: it holds stored response bodies for financial approvals, and
--    nothing in a browser has any business naming it. See lib/access/table-domains.ts.
revoke all on public.api_idempotency_keys from anon, authenticated;
grant select, insert, update, delete on public.api_idempotency_keys to service_role;

-- 2. RLS — on, with no policy, so even a mistaken future grant denies every row.
alter table public.api_idempotency_keys enable row level security;

create or replace function public.expire_api_idempotency_keys(p_older_than interval default interval '48 hours')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.api_idempotency_keys where created_at < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.expire_api_idempotency_keys(interval) from public, anon, authenticated;
grant execute on function public.expire_api_idempotency_keys(interval) to service_role;

comment on table public.api_idempotency_keys is
  'Replay store for Idempotency-Key on /api/v1 writes. Service role only; see lib/api-v1/idempotency.ts.';
