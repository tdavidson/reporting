-- Continuous partner allocations and durable close-review evidence.
-- Ordinary posted P&L is allocated on its transaction date. A close certifies and locks the
-- books; it no longer has to be the event that first updates partner capital.

create table public.journal_entry_allocations (
  id                    uuid primary key default gen_random_uuid(),
  fund_id               uuid not null references public.funds(id) on delete cascade,
  vehicle_id            uuid not null references public.fund_vehicles(id) on delete cascade,
  source_entry_id       uuid not null references public.journal_entries(id) on delete cascade,
  allocation_entry_id   uuid not null references public.journal_entries(id) on delete cascade,
  source_type           text not null,
  lp_entity_id          uuid references public.lp_entities(id) on delete cascade,
  exact_amount          numeric(30, 12) not null,
  posted_amount         numeric(20, 2) not null,
  created_at            timestamptz not null default now(),
  unique (source_entry_id, source_type, lp_entity_id)
);

create index journal_entry_allocations_vehicle_date_idx
  on public.journal_entry_allocations (fund_id, vehicle_id, created_at);
create index journal_entry_allocations_allocation_entry_idx
  on public.journal_entry_allocations (allocation_entry_id);

alter table public.journal_entry_allocations enable row level security;
grant select, insert, update, delete on public.journal_entry_allocations to service_role;
revoke all on public.journal_entry_allocations from anon, authenticated;

create policy "journal_entry_allocations service role"
  on public.journal_entry_allocations for all to service_role
  using (true) with check (true);

create table public.close_reviews (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references public.funds(id) on delete cascade,
  vehicle_id        uuid not null references public.fund_vehicles(id) on delete cascade,
  fiscal_period_id  uuid not null references public.fiscal_periods(id) on delete cascade,
  status            text not null check (status in ('approved', 'reopened')),
  prepared_by       uuid,
  approved_by       uuid,
  approved_at       timestamptz,
  attestation       text,
  trial_balance     jsonb not null default '{}'::jsonb,
  snapshot_text     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (fiscal_period_id)
);

create table public.close_review_checks (
  id                uuid primary key default gen_random_uuid(),
  close_review_id   uuid not null references public.close_reviews(id) on delete cascade,
  check_key         text not null,
  section           text not null,
  label             text not null,
  status            text not null check (status in ('passed', 'needs_review', 'blocked', 'not_applicable')),
  detail            text,
  evidence          jsonb not null default '{}'::jsonb,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (close_review_id, check_key)
);

create index close_reviews_vehicle_idx on public.close_reviews (fund_id, vehicle_id, created_at desc);
create index close_review_checks_review_idx on public.close_review_checks (close_review_id, sort_order);

alter table public.close_reviews enable row level security;
alter table public.close_review_checks enable row level security;
grant select, insert, update, delete on public.close_reviews, public.close_review_checks to service_role;
revoke all on public.close_reviews, public.close_review_checks from anon, authenticated;

create policy "close_reviews service role" on public.close_reviews for all to service_role
  using (true) with check (true);
create policy "close_review_checks service role" on public.close_review_checks for all to service_role
  using (true) with check (true);

comment on table public.journal_entry_allocations is
  'Exact and posted partner entitlements generated from each posted P&L journal entry.';
comment on table public.close_reviews is
  'Immutable evidence package and human attestation for a locked fiscal period.';
