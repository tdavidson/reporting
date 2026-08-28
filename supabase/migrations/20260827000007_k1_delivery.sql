-- Delivering a K-1 electronically, and the consent that makes it valid.
--
-- ELECTRONIC FURNISHING IS NOT JUST EMAILING A PDF. A partnership may furnish Schedule K-1
-- electronically only if the recipient has affirmatively consented, in a way that demonstrates
-- they can actually access the format it will be sent in, and only after being told the hardware
-- and software required, that a paper copy remains available, and how to withdraw. Furnishing
-- without that is not furnishing — the partnership is treated as not having provided the K-1 at
-- all, whatever landed in the partner's inbox.
--
-- So consent is a record with its own fields rather than a boolean, and it is captured before a
-- delivery can point at it. The portal already had documents, access logging and an identity
-- graph; what it did not have was the consent that makes an electronic K-1 count.

create table public.k1_delivery_consents (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,

  -- 'granted' / 'withdrawn'. Withdrawal is a state change on the same row's successor, never an
  -- erasure: whether consent stood on the day a K-1 was furnished is the whole question.
  status text not null default 'granted' check (status in ('granted', 'withdrawn')),

  -- The disclosure the partner was shown, stored VERBATIM rather than by reference. A version
  -- number would point at text that can be edited afterwards; the point of the record is to be
  -- able to say exactly what was agreed to.
  disclosure_text text not null,
  -- Free-form: 'PDF, viewable in any modern browser or PDF reader'. Recorded because the consent
  -- has to demonstrate the recipient can access the format.
  format_description text not null default 'PDF',

  consented_at timestamptz not null default now(),
  -- Who acted, and from where. An electronic consent with no trail is an assertion.
  consented_by_account uuid references public.lp_accounts(id) on delete set null,
  consent_ip           text,
  consent_user_agent   text,

  withdrawn_at timestamptz,
  created_at   timestamptz not null default now()
);

create index k1_delivery_consents_entity_idx
  on public.k1_delivery_consents (fund_id, lp_entity_id, consented_at desc);

-- ---------------------------------------------------------------------------
-- Deliveries.
-- ---------------------------------------------------------------------------
create table public.k1_deliveries (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  package_id   uuid not null references public.k1_packages(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,

  method text not null default 'portal' check (method in ('portal', 'email', 'paper')),
  -- The consent relied on. Required for an electronic method and null for paper, which needs
  -- none — enforced below rather than left to the caller.
  consent_id uuid references public.k1_delivery_consents(id) on delete restrict,

  delivered_at timestamptz not null default now(),
  delivered_by uuid,
  -- First time the partner actually opened it. Null until they do, which is itself the useful
  -- signal — a K-1 furnished and never opened is worth chasing before the filing deadline.
  first_accessed_at timestamptz,

  document_id uuid references public.lp_documents(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now(),

  -- One delivery per partner per package VERSION. An amendment is a new package, so it gets its
  -- own delivery rather than overwriting the record of the first.
  unique (package_id, lp_entity_id)
);

create index k1_deliveries_package_idx on public.k1_deliveries (package_id);
create index k1_deliveries_entity_idx  on public.k1_deliveries (fund_id, lp_entity_id);

-- Electronic delivery without a consent on file is the failure this table exists to prevent, so
-- the database refuses it rather than trusting every future caller to remember.
create or replace function public.assert_k1_delivery_consented()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if new.method = 'paper' then
    return new;
  end if;

  if new.consent_id is null then
    raise exception
      'Electronic delivery of a K-1 requires the partner''s consent on file. Record the consent, or deliver on paper.'
      using errcode = 'check_violation';
  end if;

  select status into v_status from public.k1_delivery_consents where id = new.consent_id;
  if v_status is distinct from 'granted' then
    raise exception 'That K-1 delivery consent has been withdrawn; it cannot support a new electronic delivery.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger k1_deliveries_require_consent
  before insert or update on public.k1_deliveries
  for each row execute function public.assert_k1_delivery_consented();

grant select, insert, update, delete on public.k1_delivery_consents to authenticated, service_role;
grant select, insert, update, delete on public.k1_deliveries to authenticated, service_role;

alter table public.k1_delivery_consents enable row level security;
alter table public.k1_deliveries enable row level security;

create policy "Fund members read their fund's K-1 consents"
  on public.k1_delivery_consents for select to authenticated
  using (exists (select 1 from fund_members fm where fm.fund_id = k1_delivery_consents.fund_id and fm.user_id = auth.uid()));
create policy "Fund admins manage their fund's K-1 consents"
  on public.k1_delivery_consents for all to authenticated
  using (exists (select 1 from fund_members fm where fm.fund_id = k1_delivery_consents.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'))
  with check (exists (select 1 from fund_members fm where fm.fund_id = k1_delivery_consents.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'));

create policy "Fund members read their fund's K-1 deliveries"
  on public.k1_deliveries for select to authenticated
  using (exists (select 1 from fund_members fm where fm.fund_id = k1_deliveries.fund_id and fm.user_id = auth.uid()));
create policy "Fund admins manage their fund's K-1 deliveries"
  on public.k1_deliveries for all to authenticated
  using (exists (select 1 from fund_members fm where fm.fund_id = k1_deliveries.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'))
  with check (exists (select 1 from fund_members fm where fm.fund_id = k1_deliveries.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'));

comment on table public.k1_delivery_consents is
  'Affirmative consent to receive a K-1 electronically. Stored verbatim, with a trail, because '
  'furnishing without valid consent counts as not having furnished at all.';
