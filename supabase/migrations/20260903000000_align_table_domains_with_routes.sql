-- SEC-002, second pass: make the table registry agree with the route registry.
--
-- The first pass was verified against the live database (scripts/verify-domain-rls.sql). Its
-- over-denial section found two tables filed under the wrong domain — blank pages waiting to
-- happen for a real member, not theory:
--
--   * `inbound_emails` was gated on `dealflow`. The mailbox is portfolio INTAKE; every api/emails*
--     entry in ROUTE_DOMAINS says so, with a comment about the 403 that taught them once already.
--     In a fund with `deals: off` the page gate admitted a member to /emails/[id] and RLS then
--     handed back nothing: 0 of 75.
--   * `parsing_reviews` was gated on portfolio + the `imports` feature. `imports` gates the import
--     ROUTES (api/import*); the review queue is plain portfolio (api/review,
--     api/emails/[id]/reviews). With `imports: admin`, a member's review queue was empty.
--
-- Cross-checking the rest against ROUTE_DOMAINS turned up five more of the same kind, and two of
-- those were LOOSER than the application boundary rather than tighter: a member holding only
-- `portfolio` could read crypto marks and price feeds that api/accounting/* reserves for
-- `accounting`. Those are the ones that mattered. A table gated more tightly than its routes costs
-- a page; a table gated more loosely IS the finding.
--
-- The rule, now written down rather than inferred: A TABLE'S DOMAIN IS THE DOMAIN OF THE ROUTES
-- THAT OWN IT, and where ROUTE_DOMAINS names a domain with no feature, the table names none
-- either. lib/access/table-domains.ts carries the reason on every entry that moved.
--
-- 20260902174637 is left exactly as it shipped: it is applied, and editing an applied migration
-- breaks the CLI's integrity check. This drops and re-states policies for the twelve tables whose
-- answer changed, and nothing else.

-- Drop whatever the first pass created for these, by whatever name.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'parsing_reviews', 'inbound_emails', 'email_requests', 'fund_capital_events',
    'fund_holding_terms', 'fund_nav_statements', 'crypto_wallets', 'crypto_wallet_balances',
    'price_feeds', 'price_observations', 'user_activity_logs', 'fund_vehicles'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'align_table_domains: public.% does not exist', t;
    end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---- accounting ----------------------------------------------------
-- Marks and wallet balances are ledger inputs — api/accounting/crypto-wallets and api/accounting/price-feeds. Portfolio was looser than the route.

create policy "crypto_wallets read needs accounting"
  on public.crypto_wallets for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "crypto_wallets insert needs accounting write"
  on public.crypto_wallets for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "crypto_wallets update needs accounting write"
  on public.crypto_wallets for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "crypto_wallets delete needs accounting write"
  on public.crypto_wallets for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "crypto_wallet_balances read needs accounting"
  on public.crypto_wallet_balances for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "crypto_wallet_balances insert needs accounting write"
  on public.crypto_wallet_balances for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "crypto_wallet_balances update needs accounting write"
  on public.crypto_wallet_balances for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "crypto_wallet_balances delete needs accounting write"
  on public.crypto_wallet_balances for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "price_feeds read needs accounting"
  on public.price_feeds for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "price_feeds insert needs accounting write"
  on public.price_feeds for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "price_feeds update needs accounting write"
  on public.price_feeds for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "price_feeds delete needs accounting write"
  on public.price_feeds for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

create policy "price_observations read needs accounting"
  on public.price_observations for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "price_observations insert needs accounting write"
  on public.price_observations for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "price_observations update needs accounting write"
  on public.price_observations for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "price_observations delete needs accounting write"
  on public.price_observations for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

-- ---- portfolio -----------------------------------------------------
-- The mailbox and the review queue: intake, gated like the rest of portfolio.

create policy "parsing_reviews read needs portfolio"
  on public.parsing_reviews for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "parsing_reviews insert needs portfolio write"
  on public.parsing_reviews for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "parsing_reviews update needs portfolio write"
  on public.parsing_reviews for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "parsing_reviews delete needs portfolio write"
  on public.parsing_reviews for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create policy "inbound_emails read needs portfolio"
  on public.inbound_emails for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "inbound_emails insert needs portfolio write"
  on public.inbound_emails for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "inbound_emails update needs portfolio write"
  on public.inbound_emails for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "inbound_emails delete needs portfolio write"
  on public.inbound_emails for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

-- ---- portfolio + asks -------------------------------------------------
-- The asks table, matching api/requests*.

create policy "email_requests read needs portfolio"
  on public.email_requests for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio', 'asks')));
create policy "email_requests insert needs portfolio write"
  on public.email_requests for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'asks')));
create policy "email_requests update needs portfolio write"
  on public.email_requests for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'asks')))
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'asks')));
create policy "email_requests delete needs portfolio write"
  on public.email_requests for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'asks')));

-- ---- portfolio + investments ------------------------------------------
-- The fund-of-funds register, matching api/portfolio/fund-holdings*.

create policy "fund_capital_events read needs portfolio"
  on public.fund_capital_events for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio', 'investments')));
create policy "fund_capital_events insert needs portfolio write"
  on public.fund_capital_events for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));
create policy "fund_capital_events update needs portfolio write"
  on public.fund_capital_events for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'investments')))
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));
create policy "fund_capital_events delete needs portfolio write"
  on public.fund_capital_events for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));

create policy "fund_holding_terms read needs portfolio"
  on public.fund_holding_terms for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio', 'investments')));
create policy "fund_holding_terms insert needs portfolio write"
  on public.fund_holding_terms for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));
create policy "fund_holding_terms update needs portfolio write"
  on public.fund_holding_terms for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'investments')))
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));
create policy "fund_holding_terms delete needs portfolio write"
  on public.fund_holding_terms for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));

create policy "fund_nav_statements read needs portfolio"
  on public.fund_nav_statements for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio', 'investments')));
create policy "fund_nav_statements insert needs portfolio write"
  on public.fund_nav_statements for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));
create policy "fund_nav_statements update needs portfolio write"
  on public.fund_nav_statements for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'investments')))
  with check (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));
create policy "fund_nav_statements delete needs portfolio write"
  on public.fund_nav_statements for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio', 'investments')));

-- ---- user_activity_logs ----------------------------------------------------------------------------
-- Per-user, and nothing reads it with the user-context client (api/auth/activity uses the service
-- role), so owner-private costs nothing and is the honest description of the row.
create policy "user_activity_logs is private to its owner"
  on public.user_activity_logs for all to authenticated
  using (fund_id = any(public.get_my_fund_ids()) and user_id = auth.uid())
  with check (fund_id = any(public.get_my_fund_ids()) and user_id = auth.uid());

-- ---- fund_vehicles ------------------------------------------------------------------------------
-- Four domains name a vehicle and none of them owns it. Permissive policies OR together, so this
-- states exactly that instead of the first pass's "any member of the fund". The names are not the
-- sensitive part; the balances hanging off them are, and those are gated on their own tables.
create policy "fund_vehicles read needs accounting"
  on public.fund_vehicles for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "fund_vehicles read needs lp_capital"
  on public.fund_vehicles for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_capital')));
create policy "fund_vehicles read needs gp_economics"
  on public.fund_vehicles for select to authenticated
  using (fund_id = any(public.fund_ids_readable('gp_economics')));
create policy "fund_vehicles read needs portfolio"
  on public.fund_vehicles for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "fund_vehicles insert needs accounting write"
  on public.fund_vehicles for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "fund_vehicles update needs accounting write"
  on public.fund_vehicles for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "fund_vehicles delete needs accounting write"
  on public.fund_vehicles for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));
