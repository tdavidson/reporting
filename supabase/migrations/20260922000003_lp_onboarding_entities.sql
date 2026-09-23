-- LP onboarding, third pass.
--
--   1. Exclusion. Not every entity owes onboarding documents: the fund's own GP entity, a
--      transferee admitted by assignment, an entity that closed on paper years ago. An excluded
--      entity is off the checklist, out of requests and reminders, and hidden from the portal.
--      GP-class entities start excluded.
--   2. Electronic K-1 delivery consent as a checklist item. The consent table and its paper
--      fallback exist (20260827000007); this lets the LP give consent from their checklist, with
--      the disclosure shown and stored verbatim, instead of the fund recording it for them.
--   3. More audit actions: an LP renaming their entity, withdrawing an unreviewed upload,
--      consenting; the fund excluding or including an entity.

alter table public.lp_entities
  add column if not exists onboarding_excluded boolean not null default false;
comment on column public.lp_entities.onboarding_excluded is
  'Off the onboarding checklist, requests and reminders. GP-class entities start excluded.';

update public.lp_entities set onboarding_excluded = true where partner_class = 'gp';

alter table public.lp_onboarding_items drop constraint if exists lp_onboarding_items_kind_check;
alter table public.lp_onboarding_items add constraint lp_onboarding_items_kind_check check (kind in (
  'subscription_agreement', 'lpa_signature', 'tax_form', 'kyc_identity', 'kyc_entity',
  'beneficial_ownership', 'accreditation', 'side_letter', 'wire_instructions', 'k1_econsent', 'other'
));

alter table public.lp_onboarding_events drop constraint if exists lp_onboarding_events_action_check;
alter table public.lp_onboarding_events add constraint lp_onboarding_events_action_check check (action in (
  'submitted', 'filed', 'verified', 'rejected', 'waived', 'reset', 'requested',
  'renamed', 'withdrawn', 'consented', 'excluded', 'included'
));
