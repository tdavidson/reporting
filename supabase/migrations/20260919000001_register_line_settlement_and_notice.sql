-- What a register line knows about its own life after it was frozen.
--
-- A call line records what a partner was asked for. Three things happen to it afterwards that the
-- line itself had no room for: a notice is published for it, the partner says "we've wired", and
-- the money arrives. The first two are recorded here. The third comes from the ledger (the
-- funding entry credits the receivable for the partner, and lib/accounting/settlement.ts applies
-- those oldest-call-first) — EXCEPT on a capital-tracking vehicle, which keeps no receivable, so
-- there the funding is recorded on the line by hand.
--
-- `settled_amount` / `settled_on` are therefore only ever written for a tracking vehicle. On a
-- ledger vehicle they stay null and the ledger is the truth; a value there would be a second
-- source, which is the thing this codebase does not allow.

alter table public.capital_call_lines
  -- The notice PDF (an lp_documents row) published for this line. Re-publishing reuses it rather
  -- than filing a second copy in the partner's portal.
  add column if not exists notice_document_id uuid references public.lp_documents(id) on delete set null,
  -- The partner's acknowledgment from their portal: when they wired, and the reference they used.
  -- A hint for the bank matcher, never a settlement — money is settled by the ledger.
  add column if not exists ack_at timestamptz,
  add column if not exists ack_wired_on date,
  add column if not exists ack_reference text,
  add column if not exists ack_note text,
  add column if not exists ack_lp_account_id uuid references public.lp_accounts(id) on delete set null,
  -- Tracking vehicles only: the funding, recorded by hand.
  add column if not exists settled_amount numeric,
  add column if not exists settled_on date;

alter table public.distribution_lines
  add column if not exists notice_document_id uuid references public.lp_documents(id) on delete set null,
  -- Tracking vehicles only: the payment, recorded by hand.
  add column if not exists settled_amount numeric,
  add column if not exists settled_on date;

comment on column public.capital_call_lines.settled_amount is
  'Capital-tracking vehicles only: what the partner funded against this line, recorded by hand. '
  'Null on a ledger vehicle, where the receivable is the record.';
comment on column public.capital_call_lines.ack_reference is
  'The wire reference the partner gave when acknowledging the notice in their portal. A hint for '
  'bank matching; the ledger decides settlement.';
