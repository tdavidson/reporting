-- Quoted holdings — a position whose fair value comes from an observable price rather than
-- from a human entering a round.
--
-- WHY A FEED AND NOT A HOLDING TYPE. The obvious modelling is a `holding_type` of
-- 'listed_equity'. It is wrong, and the case that proves it is an IPO: a portfolio company
-- that lists is the SAME company, with the same private rounds in its history, whose price
-- simply starts coming from an exchange on a particular date. Making it a holding type would
-- force the row to change identity mid-life and orphan everything behind it. `holding_type`
-- answers what a holding IS; a feed answers where its price COMES FROM. They are orthogonal,
-- and only the second one is new here.
--
-- The same table therefore serves a listed equity, an IPO'd portfolio company, and a digital
-- asset without distinguishing between them anywhere in the valuation path.

-- ---------------------------------------------------------------------------
-- 1. The feed — one per holding per instrument.
-- ---------------------------------------------------------------------------
create table public.price_feeds (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,

  kind         text not null check (kind in ('listed_equity', 'digital_asset')),

  -- The instrument, in whatever terms its market names it. A bare ticker is AMBIGUOUS —
  -- the same symbol trades on several venues at different prices — so `exchange` (an ISO
  -- 10383 MIC: XNAS, XLON) is part of the identity for a listed equity, and `chain` is for
  -- a token whose contract address is only unique within its network.
  symbol       text not null,
  exchange     text,
  chain        text,
  contract_address text,

  -- Quote currency, which is NOT the fund's currency and NOT always the obvious one: a
  -- London listing quotes in GBp — PENCE — so a position read as GBP is off by 100x before
  -- the FX path has even seen it. Stored explicitly, never inferred from the exchange.
  quote_currency text not null default 'USD',
  -- Divisor taking the quoted figure to one major unit of `quote_currency`. 100 for a GBp
  -- listing, 1 everywhere else. Applied before any FX translation.
  quote_scale    numeric not null default 1 check (quote_scale > 0),

  provider     text not null default 'manual',
  provider_id  text,

  -- The date this instrument STARTS being priced by the feed — a listing date, or the day
  -- the fund bought it. Before it, the holding marks from its rounds as it always did, which
  -- is what makes the IPO case work: the private history is untouched and still correct.
  active_from  date not null,
  -- Set when the feed stops being the source (delisted, taken private, position closed).
  active_until date,

  -- Shares held through an IPO lock-up are marked at the quoted price LESS a discount for
  -- lack of marketability, which is what drops them from Level 1 to Level 2 under ASC 820.
  -- Null means unrestricted. A fund whose policy is "no DLOM" simply leaves the discount at
  -- zero and still gets the correct level, because the restriction date is what levels it.
  restriction_until  date,
  restriction_discount numeric check (
    restriction_discount is null or (restriction_discount >= 0 and restriction_discount < 1)
  ),

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,

  -- One live feed per holding. A second one would mean two prices for one position and the
  -- winner would be whichever the query happened to return first.
  unique (company_id, active_from)
);

create index price_feeds_fund_idx    on public.price_feeds (fund_id, company_id);
create index price_feeds_active_idx  on public.price_feeds (fund_id, active_from);

comment on column public.price_feeds.quote_scale is
  'Divisor from the quoted figure to one major currency unit. 100 for a GBp (pence) listing, 1 otherwise.';
comment on column public.price_feeds.active_from is
  'First date the feed prices this holding — a listing date, or the purchase date. Earlier periods mark from rounds.';

-- ---------------------------------------------------------------------------
-- 2. Observations — the quotes themselves, PERSISTED.
-- ---------------------------------------------------------------------------
-- Never re-fetched at read time, and this is the single most important decision in the file.
-- A close struck on a price is an assertion about a moment: an auditor will ask, a year later,
-- what this position was marked at on 31 December and why. Providers revise history, correct
-- bad prints, and go out of business. A stored observation answers the question; a live call
-- answers a different one and cannot be told apart from the right answer.
create table public.price_observations (
  id          uuid primary key default gen_random_uuid(),
  fund_id     uuid not null references funds(id) on delete cascade,
  feed_id     uuid not null references public.price_feeds(id) on delete cascade,

  -- The market date the price belongs to, NOT when it was fetched. For a listed equity this
  -- is a trading day; for a token it is the date of whatever daily cut the fund has settled on.
  as_of_date  date not null,
  -- As quoted, before quote_scale and before FX. Stored raw so a scale or rate error is
  -- correctable without re-fetching, and so the stored figure matches the provider's screen.
  price       numeric not null check (price >= 0),

  -- 'close' is the official closing price and the only basis an ASC 820 Level 1 mark should
  -- use. The others are recorded so an intraday or indicative quote cannot be mistaken for one.
  basis       text not null default 'close' check (basis in ('close', 'intraday', 'indicative')),

  source      text not null default 'manual',
  fetched_at  timestamptz not null default now(),
  created_by  uuid,
  created_at  timestamptz not null default now(),

  -- One observation per feed per date. A corrected price UPDATES the row rather than adding
  -- a second that silently wins by insertion order — the bug the FoF NAV table avoided the
  -- same way (20260806000000).
  unique (feed_id, as_of_date)
);

create index price_observations_feed_idx on public.price_observations (feed_id, as_of_date desc);
create index price_observations_fund_idx on public.price_observations (fund_id, as_of_date desc);

-- ---------------------------------------------------------------------------
-- 3. The instruments themselves, on the SOI's by-asset-type breakout.
-- ---------------------------------------------------------------------------
-- security_type is CHECK-constrained and lib/accounting/soi.ts keeps the labels. Both must
-- list the same keys or an insert of a perfectly valid instrument fails at the database.
alter table public.investment_transactions
  drop constraint if exists investment_transactions_security_type_check;

alter table public.investment_transactions
  add constraint investment_transactions_security_type_check
  check (security_type is null or security_type in (
    'preferred',
    'common',
    'safe',
    'convertible_note',
    'warrant',
    'option',
    'llc_units',
    'listed_equity',
    'digital_asset',
    'other'
  ));

-- ---------------------------------------------------------------------------
-- 4. Grants — required from 2026-05-30 onward for the Data API to see these tables.
--    anon = SELECT only (no unauthenticated writes); authenticated + service_role full CRUD,
--    with RLS scoping per-row access.
-- ---------------------------------------------------------------------------
grant select on public.price_feeds to anon;
grant select, insert, update, delete on public.price_feeds to authenticated, service_role;
grant select on public.price_observations to anon;
grant select, insert, update, delete on public.price_observations to authenticated, service_role;

-- 5. RLS.
alter table public.price_feeds        enable row level security;
alter table public.price_observations enable row level security;

-- 6. Policies — fund members read and manage, matching investment_transactions, which is the
--    sibling table a booked quote produces.
create policy "Fund members read price feeds"
  on public.price_feeds for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage price feeds"
  on public.price_feeds for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy "Fund members read price observations"
  on public.price_observations for select to authenticated
  using (fund_id = any(public.get_my_fund_ids()));
create policy "Fund members manage price observations"
  on public.price_observations for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));
