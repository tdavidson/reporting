-- How a vehicle's books were started. This was a local React state in the onboarding
-- card, so it was lost on every refresh and nothing downstream could read it.
--
--   full_history — the ledger is reconstructed from inception (bank import + entries).
--                  Opening balances are DERIVED from that history; asking the user to
--                  enter them would double-count the fund's entire capital.
--   cutover      — the ledger starts at a date with a booked opening-balance entry,
--                  the way a fund admin takes over mid-life.
--
-- Null = not yet chosen.

alter table public.vehicle_accounting_settings
  add column if not exists history_mode text
    check (history_mode is null or history_mode in ('full_history', 'cutover'));

comment on column public.vehicle_accounting_settings.history_mode is
  'full_history = ledger rebuilt from inception (opening balances derived, not entered); cutover = books start at a date with an explicit opening-balance entry.';
