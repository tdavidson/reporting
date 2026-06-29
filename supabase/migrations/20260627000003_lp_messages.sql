-- LP portal "Contact / ask a question" messages. Submitted by an LP from the
-- portal; emailed to the fund's admins and recorded here so nothing is lost if
-- email isn't configured (and so a GP inbox view can be built later).
create table public.lp_messages (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid not null references funds(id) on delete cascade,
  lp_account_id   uuid references lp_accounts(id) on delete set null,
  lp_investor_id  uuid references lp_investors(id) on delete set null,
  from_email      text,
  subject         text,
  body            text not null,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz not null default now()
);

-- Grants — anon SELECT only; authenticated + service_role full CRUD, RLS scopes rows.
grant select on public.lp_messages to anon;
grant select, insert, update, delete on public.lp_messages to authenticated, service_role;

alter table public.lp_messages enable row level security;

-- Fund admins/members read their fund's LP messages. Inserts come from the
-- service-role API (LPs don't write directly), so no LP insert policy is needed.
create policy "Fund members read their fund's LP messages"
  on public.lp_messages for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_messages.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins update their fund's LP messages"
  on public.lp_messages for update to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_messages.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index lp_messages_fund_idx on public.lp_messages (fund_id, created_at desc);
