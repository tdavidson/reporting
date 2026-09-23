-- LP onboarding, second pass: the gaps between the LP, the fund and the deadline.
--
--   1. An item holds a SET of documents. A KYC packet is a formation certificate, an operating
--      agreement and an incumbency certificate; a second upload used to replace the first.
--      lp_onboarding_items.document_id stays as "the latest", and lp_onboarding_item_documents is
--      every file ever filed against the item.
--   2. An audit trail. Who verified, sent back, waived or reset an item, when, with what note —
--      a second waiver used to overwrite the first. lp_onboarding_events is append-only.
--   3. An LP's upload is an event in the access log, next to their views and downloads.
--   4. A sent-back item is emailed to the LP, and the delivery log gets a kind for it.
--   5. The investor record grows past a name: a contact on the investor (also the fallback
--      address for onboarding requests when there is no portal account), and on the entity the
--      facts a subscription document is filled from — type, jurisdiction, address, notice email,
--      signatories.

-- ---------------------------------------------------------------------------------------------
-- 1. Documents per item
-- ---------------------------------------------------------------------------------------------
create table public.lp_onboarding_item_documents (
  id                   uuid primary key default gen_random_uuid(),
  fund_id              uuid not null references funds(id) on delete cascade,
  item_id              uuid not null references public.lp_onboarding_items(id) on delete cascade,
  document_id          uuid not null references public.lp_documents(id) on delete cascade,
  -- Who filed it: the LP account through the portal, or the fund user.
  added_by_account     uuid references public.lp_accounts(id) on delete set null,
  added_by_user        uuid references auth.users(id) on delete set null,
  added_at             timestamptz not null default now(),
  unique (item_id, document_id)
);
create index lp_onboarding_item_documents_item_idx on public.lp_onboarding_item_documents (item_id, added_at);

grant select on public.lp_onboarding_item_documents to anon;
grant select, insert, update, delete on public.lp_onboarding_item_documents to authenticated, service_role;
alter table public.lp_onboarding_item_documents enable row level security;

create policy "lp_onboarding_item_documents read needs lp_relations"
  on public.lp_onboarding_item_documents for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_item_documents insert needs lp_relations write"
  on public.lp_onboarding_item_documents for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_item_documents update needs lp_relations write"
  on public.lp_onboarding_item_documents for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_item_documents delete needs lp_relations write"
  on public.lp_onboarding_item_documents for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
-- An LP reads the files on their own entities' items (the portal uses the service role; defence in depth).
create policy "lp_onboarding_item_documents_select_own_entity"
  on public.lp_onboarding_item_documents for select to authenticated
  using (item_id in (
    select i.id from public.lp_onboarding_items i
    join public.lp_entities e on e.id = i.lp_entity_id
    where e.investor_id = any(public.get_my_lp_investor_ids())
  ));

-- Existing single documents become the first row of their item's set.
insert into public.lp_onboarding_item_documents (fund_id, item_id, document_id, added_by_account, added_at)
select i.fund_id, i.id, i.document_id, i.submitted_by_account, coalesce(i.submitted_at, i.created_at)
from public.lp_onboarding_items i
where i.document_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. Audit trail
-- ---------------------------------------------------------------------------------------------
create table public.lp_onboarding_events (
  id                 uuid primary key default gen_random_uuid(),
  fund_id            uuid not null references funds(id) on delete cascade,
  item_id            uuid references public.lp_onboarding_items(id) on delete set null,
  lp_entity_id       uuid not null references lp_entities(id) on delete cascade,
  kind               text not null,
  action             text not null check (action in ('submitted', 'filed', 'verified', 'rejected', 'waived', 'reset', 'requested')),
  from_status        text,
  to_status          text,
  note               text,
  document_id        uuid references public.lp_documents(id) on delete set null,
  actor_user_id      uuid references auth.users(id) on delete set null,
  actor_account_id   uuid references public.lp_accounts(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index lp_onboarding_events_entity_idx on public.lp_onboarding_events (fund_id, lp_entity_id, created_at desc);

grant select on public.lp_onboarding_events to anon;
grant select, insert, update, delete on public.lp_onboarding_events to authenticated, service_role;
alter table public.lp_onboarding_events enable row level security;

create policy "lp_onboarding_events read needs lp_relations"
  on public.lp_onboarding_events for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_events insert needs lp_relations write"
  on public.lp_onboarding_events for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_events update needs lp_relations write"
  on public.lp_onboarding_events for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_onboarding_events delete needs lp_relations write"
  on public.lp_onboarding_events for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));

-- ---------------------------------------------------------------------------------------------
-- 3. Uploads in the access log
-- ---------------------------------------------------------------------------------------------
alter table public.lp_access_events drop constraint if exists lp_access_events_event_type_check;
alter table public.lp_access_events add constraint lp_access_events_event_type_check
  check (event_type in ('login', 'view', 'download', 'upload'));

-- ---------------------------------------------------------------------------------------------
-- 4. A sent-back item is emailed
-- ---------------------------------------------------------------------------------------------
alter table public.lp_deliveries drop constraint if exists lp_deliveries_kind_check;
alter table public.lp_deliveries add constraint lp_deliveries_kind_check check (kind in (
  'notice', 'receipt', 'statement', 'letter', 'snapshot', 'document', 'announcement', 'reply',
  'invite', 'onboarding_request', 'onboarding_review'
));

-- ---------------------------------------------------------------------------------------------
-- 5. The investor record
-- ---------------------------------------------------------------------------------------------
alter table public.lp_investors
  add column if not exists contact_name  text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;
comment on column public.lp_investors.contact_email is
  'The relationship contact. Also where an onboarding request goes when the investor has no portal account.';

alter table public.lp_entities
  add column if not exists entity_type text check (entity_type is null or entity_type in (
    'individual', 'joint', 'llc', 'partnership', 'corporation', 'trust', 'ira', 'foundation', 'endowment',
    'pension', 'fund_of_funds', 'family_office', 'other'
  )),
  add column if not exists formation_jurisdiction text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists postal_code text,
  add column if not exists country text,
  add column if not exists notice_email text,
  -- [{ name, title, email }] — who signs for the entity.
  add column if not exists signatories jsonb not null default '[]'::jsonb,
  add column if not exists profile_notes text,
  add column if not exists profile_updated_at timestamptz;
