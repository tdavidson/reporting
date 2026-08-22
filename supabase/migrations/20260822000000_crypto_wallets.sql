-- Digital assets: a holding that is neither a company nor a fund, and the public addresses the
-- fund watches to prove what it holds.
--
-- WHY 'crypto' IS A HOLDING TYPE WHEN 'listed equity' IS NOT. A listed equity is still a
-- company — the same row, with its private rounds behind it, whose price starts coming from an
-- exchange on a date. That is a price source, and price_feeds models it. A token is genuinely
-- not a company: it has no founders, no stage, no board, no industry, and every company-shaped
-- surface in this app would be wrong about it. So this one earns the discriminator.
--
-- THE ASSET IS THE HOLDING; A WALLET IS A PLACE IT SITS. One address holds several tokens, and
-- one token can sit in several addresses. Making the wallet the holding would put a multi-token
-- address on one line of the schedule of investments, which is neither what the fund holds nor
-- what ASC 946 asks for. So a `companies` row with holding_type='crypto' is the asset, and a
-- wallet is an address observed for it. Two wallets holding the same token roll into one
-- position; one wallet holding three tokens produces three.

-- ---------------------------------------------------------------------------
-- 1. The discriminator.
-- ---------------------------------------------------------------------------
-- Re-declared rather than edited: 20260806000000 has shipped, and historical migrations are
-- never modified (see CLAUDE.md).
alter table public.companies
  drop constraint if exists companies_holding_type_check;

alter table public.companies
  add constraint companies_holding_type_check
  check (holding_type in ('company', 'fund', 'crypto'));

-- ---------------------------------------------------------------------------
-- 2. Wallets — public addresses attributed to one asset holding.
-- ---------------------------------------------------------------------------
create table public.crypto_wallets (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references funds(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,

  chain      text not null,
  -- Public, so there is nothing to encrypt here. A watch-only address is not a credential and
  -- storing it in the clear is what lets anyone reading the books verify the position for
  -- themselves — which is the entire advantage this asset class has over a private holding.
  address    text not null,
  label      text,

  -- Which vehicle's books this wallet belongs to. `investment_transactions.portfolio_group` is
  -- a scalar, so a wallet shared across two vehicles would need an allocation rule that does
  -- not exist yet; one wallet, one vehicle, enforced by convention here and checked at close.
  portfolio_group text,

  -- ------------------------------------------------------------------
  -- Proof of control. A watched address proves a BALANCE, not OWNERSHIP.
  -- ------------------------------------------------------------------
  -- Anyone can watch any address, so an unverified wallet is an assertion, not evidence, and an
  -- auditor will ask how the fund knows it controls these keys. Recorded rather than assumed:
  -- the close warns while it is unverified rather than pretending the question was not asked.
  verified_at     timestamptz,
  verification_method text check (
    verification_method is null or verification_method in ('signed_message', 'test_transaction', 'custodian_statement')
  ),
  verification_note text,

  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,

  -- The same address on the same chain cannot be watched twice for one fund: two rows would
  -- double-count the balance into the position.
  unique (fund_id, chain, address)
);

create index crypto_wallets_holding_idx on public.crypto_wallets (fund_id, company_id);

comment on column public.crypto_wallets.address is
  'Public watch-only address. Never a key or a seed — nothing here can move funds.';
comment on column public.crypto_wallets.verified_at is
  'When control of this address was last demonstrated. Null means the balance is observed but '
  'ownership is unproven, which the close reports as a warning.';

-- ---------------------------------------------------------------------------
-- 3. Observed balances — how many units the chain says the wallet holds.
-- ---------------------------------------------------------------------------
-- Separate from the price for the same reason cost and mark are separate accounts: a position
-- moves because the quantity changed or because the price did, and blending them makes the
-- change impossible to explain.
--
-- This is the CHAIN'S answer, deliberately NOT the fund's. The books' quantity comes from
-- recorded transactions; this column comes from the address. Where they disagree, something
-- happened that was never recorded — which is precisely the check worth having, and the reason
-- an observed balance never silently becomes the carrying quantity.
create table public.crypto_wallet_balances (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references funds(id) on delete cascade,
  wallet_id  uuid not null references public.crypto_wallets(id) on delete cascade,

  as_of_date date not null,
  -- numeric, unconstrained scale: an 18-decimal token quantity is ordinary, and any fixed
  -- scale here would silently truncate it. Never route a quantity through a money-shaped
  -- column — bank_transactions.amount is numeric(20,2) and would round it to nothing.
  units      numeric not null check (units >= 0),

  -- Block height the balance was read at, where the provider reports one. A balance without it
  -- cannot be reproduced later; with it, anyone can re-read the same number from the chain.
  block_height bigint,

  source     text not null default 'manual',
  created_by uuid,
  created_at timestamptz not null default now(),

  -- One observation per wallet per date. A correction UPDATES rather than adding a second row
  -- that would then win by insertion order.
  unique (wallet_id, as_of_date)
);

create index crypto_wallet_balances_wallet_idx
  on public.crypto_wallet_balances (wallet_id, as_of_date desc);
create index crypto_wallet_balances_fund_idx
  on public.crypto_wallet_balances (fund_id, as_of_date desc);

-- ---------------------------------------------------------------------------
-- 4. Grants — required from 2026-05-30 onward for the Data API to see these tables.
--    anon = SELECT only (no unauthenticated writes); authenticated + service_role full CRUD,
--    with RLS scoping per-row access.
-- ---------------------------------------------------------------------------
grant select on public.crypto_wallets to anon;
grant select, insert, update, delete on public.crypto_wallets to authenticated, service_role;
grant select on public.crypto_wallet_balances to anon;
grant select, insert, update, delete on public.crypto_wallet_balances to authenticated, service_role;

-- 5. RLS.
alter table public.crypto_wallets         enable row level security;
alter table public.crypto_wallet_balances enable row level security;

-- 6. Policies — fund members read and manage, matching price_feeds and investment_transactions.
create policy "Fund members read crypto wallets"
  on public.crypto_wallets for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage crypto wallets"
  on public.crypto_wallets for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy "Fund members read crypto wallet balances"
  on public.crypto_wallet_balances for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage crypto wallet balances"
  on public.crypto_wallet_balances for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));
