-- A K-1 package: one vehicle, one tax year, every partner's lines, frozen when it is issued.
--
-- WHY STORE WHAT CAN BE COMPUTED. Everything here is derivable from the books — that is the point
-- of the allocation engine. But a K-1 is a statement made to a partner and to the IRS on a date,
-- and the books keep moving afterwards: a late expense is booked, a valuation is corrected, a lot
-- basis is amended. Recomputing an issued K-1 next March would produce different numbers from the
-- ones the partner filed on, with nothing to explain the difference.
--
-- Same reasoning the distribution register already carries: a figure someone was told has to
-- survive the ledger moving on. So a DRAFT package recomputes freely, and a FINAL one is frozen —
-- lines, capital accounts, and the fund-level character they were derived from, kept together so
-- the package can be explained years later without reconstructing the books as they stood.
--
-- AMENDMENT IS A NEW VERSION, not an edit. K-1s do get amended, and an amended K-1 is a distinct
-- document that supersedes rather than replaces — the partner filed on the first one.

create table public.k1_packages (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references funds(id) on delete cascade,
  vehicle_id uuid not null references fund_vehicles(id) on delete cascade,
  tax_year   int  not null,

  -- Version 1 is the original; each amendment increments. The previous version becomes
  -- 'superseded' rather than disappearing.
  version int not null default 1,
  status  text not null default 'draft' check (status in ('draft', 'final', 'superseded')),

  -- FROZEN AT FINALIZATION. The fund-level character the partner lines were split from, and the
  -- warnings that stood at the time — lines nobody could compute, gain nobody could date,
  -- partners whose tax form was missing. Kept because "why does box 9a say that" is a question
  -- asked long after the books have moved.
  fund_character jsonb,
  warnings       jsonb,

  finalized_at timestamptz,
  finalized_by uuid,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),

  -- One package per vehicle, year and version. A second DRAFT for a year that already has one is
  -- a regeneration, which updates in place rather than accumulating.
  unique (fund_id, vehicle_id, tax_year, version)
);

create index k1_packages_year_idx on public.k1_packages (fund_id, vehicle_id, tax_year, version desc);

-- ---------------------------------------------------------------------------
-- Per partner: the capital account analysis, and whether it tied.
-- ---------------------------------------------------------------------------
-- Schedule K-1 Part II item L on a TAX basis, which is the actual book plus the tax overlay and
-- not the GAAP roll-forward. The variances are stored rather than resolved: a package that had to
-- force item L to balance is telling a preparer something, and erasing it would be the one thing
-- worse than reporting it.
create table public.k1_partners (
  id           uuid primary key default gen_random_uuid(),
  package_id   uuid not null references public.k1_packages(id) on delete cascade,
  fund_id      uuid not null references funds(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,

  beginning_capital numeric not null default 0,
  contributions     numeric not null default 0,
  distributions     numeric not null default 0,
  net_income        numeric not null default 0,
  ending_capital    numeric not null default 0,

  -- Lines summed against what the capital account says the partner earned.
  tie_out_variance numeric not null default 0,
  -- beginning + contributions − distributions + income, against ending.
  roll_forward_variance numeric not null default 0,

  -- What the partner's tax form looked like when the package was built: which form, and whether
  -- it was current. Frozen because it is a fact about the issuance, not about today.
  form_type     text,
  form_standing text,

  created_at timestamptz not null default now(),
  unique (package_id, lp_entity_id)
);

create index k1_partners_package_idx on public.k1_partners (package_id);
create index k1_partners_entity_idx  on public.k1_partners (fund_id, lp_entity_id);

-- ---------------------------------------------------------------------------
-- The box lines themselves.
-- ---------------------------------------------------------------------------
-- One row per partner per category. Categories are the app's own names rather than box numbers,
-- because box numbering changes between form years and the mapping belongs in code
-- (lib/accounting/k1-allocation.ts K1_BOX) where it can be versioned.
create table public.k1_lines (
  id           uuid primary key default gen_random_uuid(),
  package_id   uuid not null references public.k1_packages(id) on delete cascade,
  fund_id      uuid not null references funds(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,
  category     text not null,
  amount       numeric not null default 0,
  created_at   timestamptz not null default now(),
  unique (package_id, lp_entity_id, category)
);

create index k1_lines_package_idx on public.k1_lines (package_id, lp_entity_id);

-- 1. Grants. SERVICE ROLE ONLY, reads included — see the reasoning in the lp_tax_forms migration
--    (20260827000003). Short version: these are per-partner tax figures, the routes that serve
--    them are gated on the `lp_capital` domain and the `tax_reporting` feature, and a
--    "fund members read their fund's rows" grant would hand every one of those figures to a
--    member the middleware refuses. Also no Data API writes: a finalised package is immutable by
--    trigger below, and a browser-side UPDATE grant is a way around the route that enforces it.
grant select, insert, update, delete on public.k1_packages to service_role;
grant select, insert, update, delete on public.k1_partners to service_role;
grant select, insert, update, delete on public.k1_lines    to service_role;

-- 2. RLS. On, with no anon/authenticated policies, so the deny survives a later stray grant.
alter table public.k1_packages enable row level security;
alter table public.k1_partners enable row level security;
alter table public.k1_lines    enable row level security;

-- ---------------------------------------------------------------------------
-- A final package does not change.
-- ---------------------------------------------------------------------------
-- Enforced in the database rather than in the route, for the reason the ledger's own enforcement
-- migration gives: a rule every caller must remember is a rule that will be forgotten. Amending
-- goes through a new version; superseding an old one is the single permitted transition.
create or replace function public.assert_k1_package_mutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'final' then
    -- The only change a final package may undergo is being superseded by its amendment.
    if new.status is distinct from 'superseded' then
      raise exception
        'K-1 package for % is final. Amend it by creating a new version rather than editing this one.',
        old.tax_year
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' and old.status in ('final', 'superseded') then
    raise exception 'A K-1 package that has been issued cannot be deleted.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger k1_packages_immutable_when_final
  before update or delete on public.k1_packages
  for each row execute function public.assert_k1_package_mutable();

-- The lines belong to the package: if it is final, they are too.
create or replace function public.assert_k1_child_mutable()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.k1_packages
  where id = coalesce(new.package_id, old.package_id);

  if v_status in ('final', 'superseded') then
    raise exception 'This K-1 package is issued; its lines cannot be changed.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger k1_partners_immutable_when_final
  before insert or update or delete on public.k1_partners
  for each row execute function public.assert_k1_child_mutable();

create trigger k1_lines_immutable_when_final
  before insert or update or delete on public.k1_lines
  for each row execute function public.assert_k1_child_mutable();
