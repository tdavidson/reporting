-- The partner's state, from the tax form, and why it is on this table.
--
-- A partnership with partners in several states can owe composite returns and nonresident
-- withholding in each of them. Which states, and which partners in each, is the worklist a
-- preparer needs — and nothing in these books recorded a state at all.
--
-- It belongs on lp_tax_forms rather than on lp_entities because the CERTIFIED address is the one
-- that matters: the address a partner attested to on a W-9 is the one the fund acted on, and it
-- is dated. An address on the partner record drifts silently and has no signature behind it.

alter table public.lp_tax_forms
  add column if not exists state text;

-- Two letters for a US state or territory. A W-8 carries no state — the partner is foreign, and
-- `country` already says so — hence nullable rather than required.
alter table public.lp_tax_forms
  drop constraint if exists lp_tax_forms_state_check;
alter table public.lp_tax_forms
  add constraint lp_tax_forms_state_check check (state is null or state ~ '^[A-Z]{2}$');

create index if not exists lp_tax_forms_state_idx on public.lp_tax_forms (fund_id, state);

comment on column public.lp_tax_forms.state is
  'Two-letter US state from the signed form. Null for a foreign partner, whose country carries '
  'the same information.';
