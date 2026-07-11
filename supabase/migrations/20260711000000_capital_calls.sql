-- Capital-call register. A "call" is a formal request for committed capital from
-- LPs; it is distinct from the cash that funds it (a wire may arrive before or
-- after the call, or fund several calls at once). The ledger recognizes the
-- contribution and a receivable (chart account 1300 "Due from LPs") when the call
-- is issued; funding later clears that receivable. These tables are the register
-- of call notices — one `capital_calls` row per call event (per-LP or fund-wide),
-- with a `capital_call_lines` row per LP. Reporting totals (called / funded /
-- outstanding) derive from the ledger; this register records the call events
-- (dates, descriptions, per-LP amounts) and links each to its journal entry.

create table public.capital_calls (
  id               uuid primary key default gen_random_uuid(),
  fund_id          uuid not null references funds(id) on delete cascade,
  vehicle_id       uuid references fund_vehicles(id) on delete cascade,
  call_date        date not null,
  call_number      int,
  description      text,
  -- 'fund_wide' = one call split across LPs (pro-rata by commitment, editable);
  -- 'per_lp'    = a call raised against specific LP(s).
  scope            text not null default 'fund_wide' check (scope in ('fund_wide', 'per_lp')),
  status           text not null default 'issued' check (status in ('draft', 'issued')),
  -- The receivable/capital journal entry this call posted (Dr 1300 / Cr LP capital).
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_at       timestamptz not null default now(),
  created_by       uuid
);

create table public.capital_call_lines (
  id           uuid primary key default gen_random_uuid(),
  call_id      uuid not null references public.capital_calls(id) on delete cascade,
  -- Denormalized fund_id/vehicle_id so RLS + vehicle scoping need no join.
  fund_id      uuid not null references funds(id) on delete cascade,
  vehicle_id   uuid references fund_vehicles(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,
  amount       numeric not null,
  created_at   timestamptz not null default now()
);

-- Grants — anon SELECT only; authenticated + service_role full CRUD, RLS scopes.
grant select on public.capital_calls to anon;
grant select, insert, update, delete on public.capital_calls to authenticated, service_role;
grant select on public.capital_call_lines to anon;
grant select, insert, update, delete on public.capital_call_lines to authenticated, service_role;

alter table public.capital_calls enable row level security;
alter table public.capital_call_lines enable row level security;

create policy "Fund members read their fund's capital calls"
  on public.capital_calls for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = capital_calls.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's capital calls"
  on public.capital_calls for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = capital_calls.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = capital_calls.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create policy "Fund members read their fund's capital call lines"
  on public.capital_call_lines for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = capital_call_lines.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's capital call lines"
  on public.capital_call_lines for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = capital_call_lines.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = capital_call_lines.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index capital_calls_fund_vehicle_idx on public.capital_calls (fund_id, vehicle_id, call_date);
create index capital_call_lines_call_idx on public.capital_call_lines (call_id);
create index capital_call_lines_lp_idx on public.capital_call_lines (fund_id, vehicle_id, lp_entity_id);
