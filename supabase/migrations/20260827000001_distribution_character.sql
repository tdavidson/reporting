-- What a distribution IS, on the way out: its form, and the character of the money.
--
-- The receive side already models this. `fund_capital_events` (20260806000000) splits an
-- incoming distribution into return of capital, realized gain and income, because a wire from
-- an underlying fund means three different things to three different reports. The issue side
-- had no equivalent: `distributions` recorded an amount and a date, and everything about what
-- the money WAS lived in a free-text description.
--
-- WHAT THIS IS ACTUALLY FOR, stated precisely, because it is easy to overclaim. A partner's
-- K-1 income boxes do NOT come from distributions — they come from the period close allocating
-- income and gain to each partner's capital account, which this ledger already does. What the
-- K-1 needs from a distribution is narrower and this migration supplies it:
--
--   * `kind` is Schedule K-1 box 19: A cash and marketable securities, B property, C other.
--     Required on every K-1 that reports a distribution, and currently underivable.
--   * The amount, per partner, frozen — which `distribution_lines` already holds — against
--     which a distribution in excess of tax basis becomes §731 gain once tax-basis capital
--     exists.
--
-- The character split earns its place for two further reasons that are not the K-1's boxes:
-- it is what a distribution notice states to an LP, and it is what makes a layered structure
-- symmetric — an outbound notice here is an inbound `fund_capital_events` row one layer up, and
-- a projection that dropped the character would arrive as an uncharacterised lump.

-- ---------------------------------------------------------------------------
-- 1. Form — K-1 box 19.
-- ---------------------------------------------------------------------------
-- 'cash' covers cash and marketable securities (box 19 A), which is every distribution this
-- app can currently produce. 'in_kind' and 'other' are declarable now so the column means
-- something on a K-1 from day one; the entries that move a SECURITY rather than cash (fair
-- value on the day, basis released, gain recognised) are a separate build.
alter table public.distributions
  add column if not exists kind text not null default 'cash';

alter table public.distributions
  drop constraint if exists distributions_kind_check;
alter table public.distributions
  add constraint distributions_kind_check check (kind in ('cash', 'in_kind', 'other'));

-- ---------------------------------------------------------------------------
-- 2. Character — the same three buckets the receive side uses.
-- ---------------------------------------------------------------------------
-- Header level, not per line: character is a property of where the money CAME FROM (we exited
-- a position at a gain; the fund earned interest), not of who receives it. Each partner's share
-- of each bucket is their frozen line amount over the total — derived, so the two cannot drift.
--
-- All three default to 0, which reads as UNCHARACTERISED rather than as "all zero". Every
-- distribution declared before this migration is in that state, and honestly so: the split was
-- never recorded and cannot be invented now.
alter table public.distributions
  add column if not exists char_return_of_capital numeric not null default 0;
alter table public.distributions
  add column if not exists char_realized_gain numeric not null default 0;
alter table public.distributions
  add column if not exists char_income numeric not null default 0;

alter table public.distributions
  drop constraint if exists distributions_character_non_negative;
alter table public.distributions
  add constraint distributions_character_non_negative check (
    char_return_of_capital >= 0 and char_realized_gain >= 0 and char_income >= 0
  );

-- NOT VALIDATED HERE: that the three buckets sum to the distribution's total. The total is the
-- sum of `distribution_lines.amount`, which no row-level CHECK can reach. It is enforced in
-- lib/accounting/distribution-character.ts, which is pure and tested, and the split is refused
-- at declaration rather than repaired afterwards.
--
-- DELIBERATELY ABSENT: `recallable_amount`. The receive side has it because it ACTS on it —
-- a recallable return restores unfunded commitment. Restoring commitment on this side means
-- writing `commitment_events`, which is a change to the allocation model rather than to this
-- register. The column belongs in the migration that implements that behaviour, not ahead of it.

comment on column public.distributions.kind is
  'Schedule K-1 box 19 form: cash (A, incl. marketable securities), in_kind (B, property), other (C).';

comment on column public.distributions.char_return_of_capital is
  'Character split, shared with the receive-side fund_capital_events. All three zero means '
  'UNCHARACTERISED, which is the honest state for anything declared before this column existed.';
