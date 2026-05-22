-- Memo Agent — editable per-stage prompt guidance
--
-- Partners want to tune how the agent analyses and writes without touching
-- code. Rather than exposing the JSON-contract prompts (which would let a
-- partner break the output format), each stage gets an editable free-text
-- "guidance" block that is injected into that stage's system prompt by
-- buildSystemPrompt. Empty guidance = the shipped default behaviour.

create table public.memo_agent_prompts (
  id          uuid        primary key default gen_random_uuid(),
  fund_id     uuid        not null references funds(id) on delete cascade,
  stage       text        not null check (stage in ('ingest', 'research', 'qa', 'draft', 'score', 'render')),
  guidance    text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (fund_id, stage)
);

-- Grants — anon = SELECT only; authenticated + service_role get full CRUD,
-- with RLS scoping per-row access by fund membership.
grant select on public.memo_agent_prompts to anon;
grant select, insert, update, delete on public.memo_agent_prompts to authenticated, service_role;

alter table public.memo_agent_prompts enable row level security;

-- Any fund member can read and edit their fund's prompt guidance — diligence
-- settings are intentionally open to all partners, not admin-only.
create policy memo_agent_prompts_select on public.memo_agent_prompts
  for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy memo_agent_prompts_insert on public.memo_agent_prompts
  for insert to authenticated
  with check (fund_id = any(public.get_my_fund_ids()));
create policy memo_agent_prompts_update on public.memo_agent_prompts
  for update to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy memo_agent_prompts_delete on public.memo_agent_prompts
  for delete to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
