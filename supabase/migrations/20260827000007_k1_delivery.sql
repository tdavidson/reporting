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

  -- When the partner consented — WHICH IS NOT ALWAYS WHEN THE ROW WAS WRITTEN. A manager
  -- entering a consent signed last month is recording that date, not today's.
  consented_at timestamptz not null default now(),

  -- HOW THIS CONSENT REACHED US, and it decides what the rest of the trail may contain.
  --
  -- 'lp_portal' — the partner acted for themselves, while logged in. Their account id, their IP
  -- and their user agent are all genuinely theirs, and together they are the attestation.
  --
  -- 'gp_recorded' — the manager is entering a consent given somewhere else: a signed form, a
  -- reply to an email. The trail here is that document. It is NOT the request headers: those
  -- belong to the manager sitting in the admin UI, and writing them into a field labelled
  -- `consent_ip` would manufacture evidence that the partner clicked something they never
  -- clicked — a worse record than an honestly empty one, because it reads as proof. The check
  -- constraint below makes that mistake impossible rather than merely discouraged.
  source text not null default 'gp_recorded' check (source in ('lp_portal', 'gp_recorded')),

  -- Who acted, and from where. Only ever populated on the 'lp_portal' path.
  consented_by_account uuid references public.lp_accounts(id) on delete set null,
  consent_ip           text,
  consent_user_agent   text,

  -- The 'gp_recorded' path's trail: the signed consent itself, and room to say where it came
  -- from when there is no document to attach.
  evidence_document_id uuid references public.lp_documents(id) on delete set null,
  evidence_note        text,

  withdrawn_at timestamptz,
  created_at   timestamptz not null default now(),

  constraint k1_delivery_consents_trail_matches_source check (
    source = 'lp_portal' or (consent_ip is null and consent_user_agent is null)
  )
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

  -- THE CONSENT MUST BE THIS PARTNER'S, IN THIS FUND. Checking only that *a* granted consent
  -- exists at that id is not a check at all: consent is personal, so one partner's consent
  -- cannot furnish another's K-1, and a consent belonging to a different fund cannot furnish
  -- anything here. Both predicates are on the lookup rather than asserted afterwards, so a row
  -- that fails either one is indistinguishable from no row — which is the answer we want.
  select status into v_status
  from public.k1_delivery_consents
  where id = new.consent_id
    and lp_entity_id = new.lp_entity_id
    and fund_id = new.fund_id;

  if not found then
    raise exception
      'That consent does not belong to this partner in this fund. Electronic delivery relies on the recipient''s own consent.'
      using errcode = 'check_violation';
  end if;

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

-- Service role only, reads included — see 20260827000003 for the reasoning. Both tables have a
-- particular reason beyond the domain one: a consent record is EVIDENCE. Its whole value is that
-- nobody could have written it except through the act of consenting, and a browser-reachable
-- INSERT grant on `authenticated` would let a fund admin manufacture one — the exact fact the
-- record exists to attest. A delivery row is the other half of the same evidence: it is the
-- fund's own record of having furnished a K-1, and a row written from a browser console is one
-- no route, and no person, ever stood behind.
grant select, insert, update, delete on public.k1_delivery_consents to service_role;
grant select, insert, update, delete on public.k1_deliveries to service_role;

alter table public.k1_delivery_consents enable row level security;
alter table public.k1_deliveries enable row level security;

comment on table public.k1_delivery_consents is
  'Affirmative consent to receive a K-1 electronically. Stored verbatim, with a trail, because '
  'furnishing without valid consent counts as not having furnished at all.';
