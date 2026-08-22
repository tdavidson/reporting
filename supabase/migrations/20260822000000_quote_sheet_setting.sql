-- Where a fund keeps its Google Finance quotes.
--
-- There is no Google Finance API — Google retired it in 2012 — so the only sanctioned access to
-- that data is the GOOGLEFINANCE() formula inside a Google Sheet. The fund keeps one sheet of
-- those formulas and the quote sync reads its computed values back.
--
-- Stored per fund rather than per feed because a fund keeps ONE sheet listing every ticker it
-- holds: GOOGLEFINANCE is rate-limited per document, and a sheet per position would multiply
-- both the fetches and the number of places a wrong cell can hide.
--
-- Read through the Drive export endpoint as CSV, which is why this is only a file id and no new
-- credential: the fund's existing Google connection already carries `drive.readonly`. Using the
-- Sheets API instead would need the `spreadsheets` scope and re-consent from every fund.
--
-- No grants block: ALTER TABLE ADD COLUMN on an existing table, and table grants already cover
-- new columns. RLS on fund_settings is unchanged.

alter table public.fund_settings
  add column if not exists quote_sheet_file_id text;

comment on column public.fund_settings.quote_sheet_file_id is
  'Google Drive file id of the sheet holding GOOGLEFINANCE quote formulas. Read as CSV via the '
  'Drive export endpoint using the fund''s existing drive.readonly grant.';

-- Last sync outcome, so the UI can say "quotes last updated 3 hours ago" and, more importantly,
-- surface a sheet that has silently stopped resolving. A feed that stops updating is invisible
-- until a close blocks on a stale quote, which is far too late to find out.
alter table public.fund_settings
  add column if not exists quote_sheet_synced_at timestamptz;

alter table public.fund_settings
  add column if not exists quote_sheet_last_error text;
