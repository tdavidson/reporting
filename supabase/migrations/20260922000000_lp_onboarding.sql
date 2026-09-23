-- LP onboarding: the documents an investor owes the fund, and the record of their arrival.
--
-- Until now the platform started once an LP was admitted. A countersigned subscription agreement
-- could be filed as a per-investor document, and a W-9 recorded on the Tax page, but nothing said
-- what an entity still owed, nothing let the LP send it, and "is this partner fully onboarded"
-- had no answer. This adds:
--
--   1. fund_settings.lp_onboarding_kinds — the fund's requirement set (see lib/lp-onboarding.ts
--      for the kinds). NULL means "the default set"; the app never needs a seeded row.
--   2. lp_onboarding_items — one row per (entity, kind) once anything has happened to it: an
--      upload from the portal, a file the fund put on the record itself, a verification, a
--      rejection with a note the LP sees, a waiver, an expiry. No row = outstanding.
--   3. A storage policy letting an LP write into their own entity's onboarding folder, and only
--      there — the first LP-initiated write the portal has had. The server issues the signed
--      upload URL and owns the path; this policy is defence in depth behind that.
--   4. lp_deliveries learns two kinds: the invite email itself, and a request for outstanding
--      onboarding documents — so both are answerable from the same log as every other LP send.

-- ---------------------------------------------------------------------------------------------
-- 1. The requirement set
-- ---------------------------------------------------------------------------------------------
alter table public.fund_settings
  add column if not exists lp_onboarding_kinds text[];

comment on column public.fund_settings.lp_onboarding_kinds is
  'Which onboarding documents this fund requires of every LP entity. NULL = the default set in lib/lp-onboarding.ts.';

-- ---------------------------------------------------------------------------------------------
-- 2. Items
-- ---------------------------------------------------------------------------------------------
create table public.lp_onboarding_items (
  id                   uuid primary key default gen_random_uuid(),
  fund_id              uuid not null references funds(id) on delete cascade,
  lp_entity_id         uuid not null references lp_entities(id) on delete cascade,
  kind                 text not null check (kind in (
    'subscription_agreement', 'lpa_signature', 'tax_form', 'kyc_identity', 'kyc_entity',
    'beneficial_ownership', 'accreditation', 'side_letter', 'wire_instructions', 'other'
  )),
  -- outstanding: asked for, nothing received. submitted: the LP uploaded, the fund has not looked.
  -- verified: the fund accepted it. rejected: sent back with a note. waived: not needed for this
  -- entity (a fund that already holds a paper copy, an entity exempt from a form).
  status               text not null default 'outstanding'
                       check (status in ('outstanding', 'submitted', 'verified', 'rejected', 'waived')),
  -- The file, in lp_documents, scoped to the entity's investor so it shows in their portal alone.
  document_id          uuid references public.lp_documents(id) on delete set null,
  -- Who sent it: the LP account when it came through the portal, null when the fund filed it.
  submitted_by_account uuid references public.lp_accounts(id) on delete set null,
  submitted_at         timestamptz,
  reviewed_by          uuid references auth.users(id) on delete set null,
  reviewed_at          timestamptz,
  -- A verified document that lapses (a W-8's three calendar years, a KYC refresh cycle).
  expires_on           date,
  -- Shown to the LP: why it was sent back, or what to send instead.
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (fund_id, lp_entity_id, kind)
);

create index lp_onboarding_items_fund_status_idx on public.lp_onboarding_items (fund_id, status);
create index lp_onboarding_items_entity_idx on public.lp_onboarding_items (lp_entity_id);

-- Grants — required from 2026-05-30 onward for the Data API to see this table.
grant select on public.lp_onboarding_items to anon;
grant select, insert, update, delete on public.lp_onboarding_items to authenticated, service_role;

alter table public.lp_onboarding_items enable row level security;

-- Policies — lp_relations, gated on the portal, like the documents it points at
-- (lib/access/table-domains.ts). Which partner has sent their subscription agreement is a
-- relationship fact.
create policy "lp_onboarding_items read needs lp_relations"
  on public.lp_onboarding_items for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_items insert needs lp_relations write"
  on public.lp_onboarding_items for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_items update needs lp_relations write"
  on public.lp_onboarding_items for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_items delete needs lp_relations write"
  on public.lp_onboarding_items for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));

-- An LP reads the items on their own entities (the portal goes through the service role and
-- scopes by hand; this mirrors lp_document_shares as defence in depth).
create policy "lp_onboarding_items_select_own_entity"
  on public.lp_onboarding_items for select to authenticated
  using (lp_entity_id in (
    select e.id from public.lp_entities e where e.investor_id = any(public.get_my_lp_investor_ids())
  ));

-- ---------------------------------------------------------------------------------------------
-- 3. Storage: an LP may write into <fund>/onboarding/<their entity>/ and nowhere else.
-- ---------------------------------------------------------------------------------------------
create policy "LPs upload their own onboarding documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'lp-documents'
    and (storage.foldername(name))[2] = 'onboarding'
    and (storage.foldername(name))[3] in (
      select e.id::text from public.lp_entities e
      where e.investor_id = any(public.get_my_lp_investor_ids())
    )
  );

-- ---------------------------------------------------------------------------------------------
-- 4. Two more things an LP can be sent
-- ---------------------------------------------------------------------------------------------
alter table public.lp_deliveries drop constraint if exists lp_deliveries_kind_check;
alter table public.lp_deliveries add constraint lp_deliveries_kind_check check (kind in (
  'notice', 'receipt', 'statement', 'letter', 'snapshot', 'document', 'announcement', 'reply',
  'invite', 'onboarding_request'
));
