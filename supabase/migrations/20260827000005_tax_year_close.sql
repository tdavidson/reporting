-- Closing a tax year: the tax book's own lock.
--
-- The fiscal-period close locks the ACTUAL book and deliberately leaves the tax book open
-- (20260827000000), because book-to-tax adjustments are dated inside the periods they adjust and
-- those periods are closed by definition. That was right, and it left a hole: nothing at all
-- locked the tax book, so a vehicle could issue a final 2026 K-1 package and then post a tax
-- adjustment dated into 2026. The package is frozen; the books it asserted are not. Nobody is
-- told, and the K-1 a partner filed on no longer reconciles to anything.
--
-- So the tax book gets the lock its own reporting cycle needs, on the boundary that cycle uses:
-- a tax YEAR rather than a fiscal period.

create table public.tax_year_closes (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references funds(id) on delete cascade,
  vehicle_id uuid not null references fund_vehicles(id) on delete cascade,
  tax_year   int  not null,

  status text not null default 'closed' check (status in ('closed', 'reopened')),

  closed_at  timestamptz not null default now(),
  closed_by  uuid,
  -- Reopening is recorded rather than erased. "Who reopened 2026 after we issued the K-1s, and
  -- why" is the question an amendment always raises.
  reopened_at     timestamptz,
  reopened_by     uuid,
  reopened_reason text,

  unique (fund_id, vehicle_id, tax_year)
);

create index tax_year_closes_lookup_idx on public.tax_year_closes (fund_id, vehicle_id, tax_year, status);

grant select, insert, update, delete on public.tax_year_closes to authenticated, service_role;
alter table public.tax_year_closes enable row level security;

create policy "Fund members read their fund's tax year closes"
  on public.tax_year_closes for select to authenticated
  using (exists (select 1 from fund_members fm where fm.fund_id = tax_year_closes.fund_id and fm.user_id = auth.uid()));
create policy "Fund admins manage their fund's tax year closes"
  on public.tax_year_closes for all to authenticated
  using (exists (select 1 from fund_members fm where fm.fund_id = tax_year_closes.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'))
  with check (exists (select 1 from fund_members fm where fm.fund_id = tax_year_closes.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'));

-- ---------------------------------------------------------------------------
-- The lock itself.
-- ---------------------------------------------------------------------------
-- Symmetric with assert_period_open_for: same shape, different book and a different boundary.
create or replace function public.assert_tax_year_open_for(
  p_fund uuid,
  p_vehicle uuid,
  p_date date
) returns void
language plpgsql
as $$
declare
  v_year int;
begin
  if p_date is null or p_fund is null then
    return;
  end if;

  select tyc.tax_year into v_year
  from public.tax_year_closes tyc
  where tyc.fund_id = p_fund
    and tyc.vehicle_id is not distinct from p_vehicle
    and tyc.status = 'closed'
    and tyc.tax_year = extract(year from p_date)
  limit 1;

  if v_year is not null then
    raise exception
      'Tax year % is closed. Reopen it before posting tax-book entries dated %.',
      v_year, p_date
      using errcode = 'check_violation';
  end if;
end;
$$;

-- Redefining the entry trigger a THIRD time rather than editing either predecessor: applied
-- migrations are never modified, and `create or replace` keeps the trigger attached. The actual
-- book answers to fiscal periods, the tax book to tax years, and neither answers to the other's.
create or replace function public.assert_entry_period_open()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    if coalesce(new.book, 'actual') = 'actual' then
      perform public.assert_period_open_for(new.fund_id, new.vehicle_id, new.entry_date);
    else
      perform public.assert_tax_year_open_for(new.fund_id, new.vehicle_id, new.entry_date);
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    if coalesce(old.book, 'actual') = 'actual' then
      perform public.assert_period_open_for(old.fund_id, old.vehicle_id, old.entry_date);
    else
      perform public.assert_tax_year_open_for(old.fund_id, old.vehicle_id, old.entry_date);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.assert_posting_period_open()
returns trigger
language plpgsql
as $$
declare
  v_fund uuid; v_vehicle uuid; v_date date; v_book text;
begin
  select je.fund_id, je.vehicle_id, je.entry_date, je.book
    into v_fund, v_vehicle, v_date, v_book
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if coalesce(v_book, 'actual') = 'actual' then
    perform public.assert_period_open_for(v_fund, v_vehicle, v_date);
  else
    perform public.assert_tax_year_open_for(v_fund, v_vehicle, v_date);
  end if;

  return coalesce(new, old);
end;
$$;

comment on table public.tax_year_closes is
  'The tax book''s lock. Fiscal periods lock the actual book; a closed tax year locks the tax '
  'book for entries dated in it. Reopening is recorded, never erased.';
