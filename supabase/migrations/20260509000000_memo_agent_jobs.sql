-- Memo Agent — async job runner
-- Stages can take 2-15 minutes per the spec, longer than the 120s Vercel
-- function ceiling. We back the agent with a `memo_agent_jobs` table that a
-- cron-driven worker (every minute) picks from. The worker runs one stage
-- per invocation, marks the row done, and the UI polls for status.

create table memo_agent_jobs (
  id            uuid        primary key default gen_random_uuid(),
  fund_id       uuid        not null references funds(id) on delete cascade,
  deal_id       uuid        not null references diligence_deals(id) on delete cascade,
  draft_id      uuid        references diligence_memo_drafts(id) on delete set null,
  kind          text        not null check (kind in ('ingest', 'research', 'qa', 'draft', 'render')),
  status        text        not null default 'pending' check (status in ('pending', 'running', 'success', 'failed', 'cancelled')),
  payload       jsonb       default '{}'::jsonb,             -- stage-specific input (e.g. document IDs to ingest)
  result        jsonb,                                       -- stage-specific output summary (full output goes on diligence_memo_drafts)
  progress_message text,                                     -- last "what's it doing" line for the UI
  error         text,
  attempts      int         not null default 0,
  enqueued_at   timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  enqueued_by   uuid        references auth.users(id),
  -- Optimistic concurrency: the worker uses this to avoid two crons claiming
  -- the same job. Bumped on every status change.
  lock_version  int         not null default 0
);

create index memo_agent_jobs_pending_idx
  on memo_agent_jobs (enqueued_at)
  where status = 'pending';
create index memo_agent_jobs_deal_idx        on memo_agent_jobs (deal_id, enqueued_at desc);
create index memo_agent_jobs_fund_idx        on memo_agent_jobs (fund_id, enqueued_at desc);
create index memo_agent_jobs_running_idx     on memo_agent_jobs (status) where status = 'running';

alter table memo_agent_jobs enable row level security;

create policy memo_agent_jobs_select on memo_agent_jobs
  for select using (fund_id = any(public.get_my_fund_ids()));
create policy memo_agent_jobs_insert on memo_agent_jobs
  for insert with check (fund_id = any(public.get_my_fund_ids()));
-- Worker writes via service role (bypasses RLS). The fund-member update
-- path is needed only for cancellation.
create policy memo_agent_jobs_update on memo_agent_jobs
  for update using (fund_id = any(public.get_my_fund_ids()));

-- Helper: atomically claim the next pending job. Returns the row that was
-- claimed, or no rows if nothing is pending. Avoids double-running across
-- overlapping cron invocations.
create or replace function memo_agent_claim_next_job()
returns memo_agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed memo_agent_jobs%rowtype;
begin
  update memo_agent_jobs
  set status = 'running',
      started_at = now(),
      attempts = attempts + 1,
      lock_version = lock_version + 1
  where id = (
    select id from memo_agent_jobs
    where status = 'pending'
    order by enqueued_at asc
    limit 1
    for update skip locked
  )
  returning * into claimed;
  return claimed;
end;
$$;
