-- The tax form behind each partner's K-1: which one, signed when, valid until when.
--
-- The K-1 numbers are computable without this. Issuing one is not: a partnership that reports a
-- partner with no certified taxpayer identification has a backup-withholding problem, and a
-- foreign partner with no W-8 is withheld on at 30% rather than at a treaty rate. So this is the
-- last thing standing between a computed K-1 and a K-1 anyone can send.
--
-- WHAT THIS DELIBERATELY DOES NOT STORE: the taxpayer identification number.
--
-- The number itself lives in the signed form, in the documents bucket, where it is already
-- protected — and it is needed by exactly one party, the preparer, who has the form. What is
-- stored here is its TYPE and its LAST FOUR DIGITS, which is enough for a person to confirm they
-- are looking at the right form and enough for an export to be checked, and not enough to be
-- worth stealing.
--
-- This is a real constraint and not a hedge: an export from this app will not carry a full SSN,
-- so a preparer takes it from the form. The alternative is that every self-hosted install of an
-- Apache-2.0 app becomes an unencrypted SSN repository maintained by whoever deployed it, which
-- is a liability this project should not manufacture on their behalf.

create table public.lp_tax_forms (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,

  -- W-9 for a US person; the W-8 series for everyone else. W-8IMY and W-8ECI are rarer but
  -- real — a feeder partnership and a partner with effectively connected income respectively —
  -- and leaving them out would push both into "other", where they lose their expiry rule.
  form_type text not null check (form_type in ('w9', 'w8ben', 'w8bene', 'w8imy', 'w8eci')),

  -- Identification, deliberately partial. See the note above.
  tin_type  text check (tin_type in ('ssn', 'ein', 'itin', 'foreign', 'none')),
  tin_last4 text check (tin_last4 ~ '^[0-9]{4}$'),

  -- As they appear ON THE FORM, which is not always how the fund records the partner. The K-1
  -- has to carry the form's version, so a mismatch is worth being able to see.
  legal_name         text,
  tax_classification text check (tax_classification in (
    'individual', 'c_corp', 's_corp', 'partnership', 'trust_estate', 'llc',
    'disregarded_entity', 'exempt_organization', 'government', 'other'
  )),

  -- W-8 only: where the partner is resident, and whether a treaty rate is claimed.
  country        text,
  treaty_claimed boolean not null default false,

  -- A W-9 can certify that the partner IS subject to backup withholding, which is a fact the
  -- fund has to act on rather than a missing form.
  subject_to_backup_withholding boolean not null default false,

  signed_date date,
  -- Stored rather than derived, because the rule has exceptions a person may need to apply: a
  -- W-8BEN with a US TIN can remain valid indefinitely, and a change in circumstances can end
  -- any form early. lib/tax/forms.ts computes the default; this column is what was decided.
  expires_on  date,

  -- The signed form itself, in the documents bucket.
  document_id uuid references public.lp_documents(id) on delete set null,

  notes      text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

-- One CURRENT form per partner is the normal case, but superseding one has to be possible —
-- a partner re-certifies, or an entity changes classification. So history is kept and the
-- current form is the latest signed one, rather than being enforced by a unique constraint that
-- would make re-certification a delete.
create index lp_tax_forms_entity_idx on public.lp_tax_forms (fund_id, lp_entity_id, signed_date desc);
create index lp_tax_forms_expiry_idx on public.lp_tax_forms (fund_id, expires_on);

-- 1. Grants. SERVICE ROLE ONLY — no anon, no authenticated, for reads or writes.
--
--    Two reasons, and the second is the one that is easy to get wrong.
--
--    Writes: NEXT_PUBLIC_SUPABASE_ANON_KEY ships to the browser and createBrowserClient is in
--    use, so an INSERT/UPDATE/DELETE grant to `authenticated` is a write path around every check
--    in the route — the same hole 20260714000004 closed on the ledger. Every write to this table
--    goes through createAdminClient() behind a gated route; the Data API has no business
--    accepting one.
--
--    Reads: a "fund members read their fund's rows" policy is the WRONG SHAPE for this table.
--    Access here is not one axis but two (lib/access/effective.ts): the route is gated on the
--    `lp_capital` domain and the `tax_reporting` feature, so a member holding only `portfolio`
--    is refused by the middleware. A blanket member-level SELECT grant hands that same member
--    legal names, TIN last-four, country and state straight from the browser console — the grants
--    silently vetoing the access model, which is exactly the bug plans/plan-access-control.md
--    exists to prevent. Rather than restate the domain rules in SQL (two places to keep in
--    agreement, one of which nobody reads), this table is not on the Data API at all.
grant select, insert, update, delete on public.lp_tax_forms to service_role;

-- 2. RLS. On, with no policies for anon/authenticated — belt to the grants' braces, so a later
--    `grant select ... to authenticated` still denies every row until someone writes a policy
--    that answers the domain question above.
alter table public.lp_tax_forms enable row level security;

comment on column public.lp_tax_forms.tin_last4 is
  'Last four digits only. The full number stays in the signed form; see the migration header.';
comment on column public.lp_tax_forms.expires_on is
  'What was DECIDED, not what the default rule computes. lib/tax/forms.ts proposes it.';
