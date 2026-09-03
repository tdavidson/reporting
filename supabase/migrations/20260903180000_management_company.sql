-- Management companies: the firm's own operating entity, on its own books.
--
-- A fund's ledger answers "what did the LPs get". It says almost nothing about the FIRM — the
-- entity that employs the team, collects the management fee, pays the rent and the payroll, and
-- lends money back and forth with the vehicles it manages. Until now the only way to keep those
-- books here was to file the manco as `kind = 'other'` and give it a fund's chart of accounts,
-- which offers it partners' capital, a schedule of investments and a capital-call button, and
-- offers it no salaries, no payroll liabilities and no intercompany accounts at all.
--
-- Three things ship together, because none of them is any use alone:
--   1. `manco` joins the vehicle kinds, so a management company can be SET UP as one.
--   2. `management_company` joins the access domains, so its books can be gated separately from
--      the funds'. This is the part that has to be right — see the seeding note in section 3.
--   3. `intercompany_transactions` records a charge between two vehicles ONCE, with a link to the
--      journal entry it booked on each side.

-- ============================================================================================
-- 1. The vehicle kind.
-- ============================================================================================
--
-- Additive: every existing row keeps its kind, and 'manco' becomes sayable. The constraint is
-- dropped and restated rather than edited because a check constraint has no ALTER.
alter table public.fund_vehicles
  drop constraint if exists fund_vehicles_kind_check;
alter table public.fund_vehicles
  add constraint fund_vehicles_kind_check
  check (kind in ('fund', 'spv', 'direct', 'associate', 'manco', 'other'));

comment on column public.fund_vehicles.kind is
  'What this vehicle IS. Decides which default chart it seeds (lib/accounting/chart.ts), which '
  'section of the app owns it, and — for ''manco'' — which access domain a request for its books '
  'must hold. See lib/accounting/vehicle-domain.ts.';

-- ============================================================================================
-- 2. The resolver learns the new feature key and the new domain.
-- ============================================================================================
--
-- `create or replace` — the last definition is what Postgres runs, and rls-domain-policies.test.ts
-- reads the LAST migration that defines each of these and compares its CASE arms with the
-- TypeScript. Both functions are restated in full so that comparison sees one complete table
-- rather than a diff it has to reconstruct.

create or replace function public.feature_default(p_feature text)
returns text
language sql
immutable
parallel safe
as $$
  select case p_feature
    when 'interactions'       then 'off'
    when 'investments'        then 'everyone'
    when 'notes'              then 'off'
    when 'lp_letters'         then 'off'
    when 'imports'            then 'everyone'
    when 'asks'               then 'admin'
    when 'lps'                then 'off'
    when 'lp_tracking'        then 'off'
    when 'lp_portal'          then 'off'
    when 'lp_activity'        then 'off'
    when 'compliance'         then 'off'
    when 'deals'              then 'off'
    when 'diligence'          then 'off'
    when 'accounting'         then 'off'
    when 'gp_economics'       then 'off'
    when 'tax_reporting'      then 'off'
    when 'management_company' then 'off'
    -- An unknown key is not a reason to open a door.
    else 'off'
  end;
$$;

create or replace function public.domain_primary_feature(p_domain text)
returns text
language sql
immutable
parallel safe
as $$
  select case p_domain
    when 'dealflow'           then 'deals'
    when 'diligence'          then 'diligence'
    when 'accounting'         then 'accounting'
    when 'management_company' then 'management_company'
    when 'lp_capital'         then 'lps'
    when 'gp_economics'       then 'gp_economics'
    when 'compliance'         then 'compliance'
    else null
  end;
$$;

-- `domain_access()` itself needs no change: it reads the domain's primary feature through the
-- function above and the member's grant out of fund_member_access / fund_domain_defaults, both of
-- which are keyed on plain text. The one hard-coded domain in it is the accounting -> lp_capital
-- implication, and management_company is deliberately NOT implied by anything (lib/access/domains.ts).

-- ============================================================================================
-- 3. Defaults for the new domain — 'none', and that is the whole point.
-- ============================================================================================
--
-- 20260716000008 seeded every domain at 'write' because it was DESCRIBING the behaviour that
-- already existed: a member could already write anything the fund had switched on, and seeding
-- anything less would have locked out working teams on deploy day.
--
-- A NEW domain has no behaviour to preserve, and this one holds the firm's payroll. Seeding it at
-- 'write' would hand every existing member the partners' compensation the moment the switch is
-- turned on — a grant nobody made, arriving silently. So it seeds at 'none' and an admin grants it
-- deliberately, per person. Admins are unaffected: `domain_access` returns 'write' for them once
-- the fund-level switch is on, without consulting a default at all.
insert into public.fund_domain_defaults (fund_id, domain, level)
select f.id, 'management_company', 'none'
from funds f
on conflict (fund_id, domain) do nothing;

-- And the same for funds created from here on. Restated in full (it is a `create or replace`), with
-- management_company as the one row that is not 'write'.
create or replace function public.seed_fund_domain_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fund_domain_defaults (fund_id, domain, level)
  select new.id, d.domain, d.level
  from (values
    ('portfolio', 'write'), ('relationships', 'write'), ('dealflow', 'write'),
    ('diligence', 'write'), ('accounting', 'write'), ('lp_capital', 'write'),
    ('gp_economics', 'write'), ('lp_relations', 'write'), ('compliance', 'write'),
    -- The firm's own books, including payroll. Granted per person, never by default.
    ('management_company', 'none')
  ) as d(domain, level)
  on conflict (fund_id, domain) do nothing;
  return new;
end;
$$;

-- ============================================================================================
-- 4. Intercompany transactions.
-- ============================================================================================
--
-- A charge between two vehicles of the same firm is ONE economic fact and TWO journal entries, and
-- the entries live on ledgers that are read separately and closed separately. Recording only the
-- entries means nothing knows they are the same charge: the manco's receivable and the fund's
-- payable drift, and no report can say which of the two is wrong.
--
-- So the fact is a row, and the entries point back at it (`source_ref = 'intercompany:<id>'`,
-- the same convention the period close uses to find its own allocation entries). The row carries
-- the entry ids as well, so the reconciliation is a lookup in either direction.
--
-- ACCRUAL AND SETTLEMENT ARE SEPARATE, because they are separate events and often separate
-- quarters: the fee is charged on the first day of the quarter and paid when the capital call
-- clears. Accruing books income/receivable on the payee and expense/payable on the payer;
-- settling books cash on both. A row that is charged and paid the same day simply gets both.
--
-- WHAT THIS TABLE IS NOT is the source of the intercompany BALANCE. That is read off the ledger —
-- the due-from/due-to sub-accounts, one per counterparty — because the ledger is what an auditor
-- ties to and what a manual correcting entry lands in. A register that computed its own balance
-- would disagree with the balance sheet the first time anyone posted a journal entry by hand, and
-- there would be no way to tell which was right. See lib/accounting/intercompany.ts.
create table public.intercompany_transactions (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references funds(id) on delete cascade,
  -- WHO OWES WHOM. `from` is the payer (expense, payable); `to` is the payee (income, receivable).
  -- A management fee is from the fund to the management company.
  from_vehicle_id   uuid not null references fund_vehicles(id) on delete cascade,
  to_vehicle_id     uuid not null references fund_vehicles(id) on delete cascade,
  -- No 'capital_contribution' here on purpose. Funding an affiliate is EQUITY, not a balance one
  -- side can demand back, and booking it through the due-from/due-to accounts would report the
  -- firm's own capital as a receivable that never settles. It is an ordinary journal entry against
  -- members' capital on both books.
  kind              text not null check (kind in (
                      'management_fee', 'expense_reimbursement', 'allocated_cost',
                      'loan_advance', 'loan_repayment', 'other')),
  charge_date       date not null,
  amount            numeric(20, 2) not null check (amount > 0),
  currency          text not null default 'USD',
  memo              text,
  status            text not null default 'accrued' check (status in ('accrued', 'settled', 'void')),
  settled_date      date,
  -- The four entries this can produce, one PAIR per event, and both halves of a pair are written
  -- together or not at all. Null until that event is booked.
  --
  -- `on delete set null`, not cascade: unposting an entry from the journal must not delete the
  -- intercompany record. The charge still happened, the other side's entry still stands, and
  -- deleting the row would silently take that link with it — leaving one ledger with a payable
  -- nothing explains.
  from_entry_id             uuid references journal_entries(id) on delete set null,
  to_entry_id               uuid references journal_entries(id) on delete set null,
  from_settlement_entry_id  uuid references journal_entries(id) on delete set null,
  to_settlement_entry_id    uuid references journal_entries(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A vehicle cannot charge itself: that would book both legs on one ledger and net to nothing
  -- while claiming a receivable.
  constraint intercompany_distinct_vehicles check (from_vehicle_id <> to_vehicle_id),
  -- A settled row has to say when.
  constraint intercompany_settled_has_date check (status <> 'settled' or settled_date is not null)
);

-- Grants — required from 2026-05-30 onward for the Data API to see this table.
-- anon = SELECT only; authenticated + service_role full CRUD, with RLS scoping per-row access.
grant select on public.intercompany_transactions to anon;
grant select, insert, update, delete on public.intercompany_transactions to authenticated, service_role;

alter table public.intercompany_transactions enable row level security;

-- Gated on `management_company`, not `accounting`, and not both. The FUND side of a charge is
-- already visible to anyone holding `accounting` — it is an ordinary expense entry in the fund's
-- own journal. What this table adds is the manco's view of the relationship, which belongs with
-- the manco's books. See lib/access/table-domains.ts.
create policy "intercompany_transactions read needs management_company"
  on public.intercompany_transactions for select to authenticated
  using (fund_id = any(public.fund_ids_readable('management_company')));
create policy "intercompany_transactions insert needs management_company write"
  on public.intercompany_transactions for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('management_company')));
create policy "intercompany_transactions update needs management_company write"
  on public.intercompany_transactions for update to authenticated
  using (fund_id = any(public.fund_ids_writable('management_company')))
  with check (fund_id = any(public.fund_ids_writable('management_company')));
create policy "intercompany_transactions delete needs management_company write"
  on public.intercompany_transactions for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('management_company')));

create index intercompany_transactions_fund_idx
  on public.intercompany_transactions (fund_id, charge_date desc);
create index intercompany_transactions_from_idx
  on public.intercompany_transactions (fund_id, from_vehicle_id, status);
create index intercompany_transactions_to_idx
  on public.intercompany_transactions (fund_id, to_vehicle_id, status);

create trigger set_intercompany_transactions_updated_at
  before update on public.intercompany_transactions
  for each row execute function public.set_updated_at();

comment on table public.intercompany_transactions is
  'One charge between two vehicles of the same firm, with a link to the journal entry it booked on '
  'each side. Accrual and settlement are separate events; see lib/accounting/intercompany.ts.';
