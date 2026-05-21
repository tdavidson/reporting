-- Memo Agent — configurable export formatting
--
-- The Word / Google Doc memo export uses a fund-configurable base font and
-- size. Defaults chosen: DM Sans at 11pt.

alter table fund_settings
  add column if not exists memo_export_font_family text default 'DM Sans',
  add column if not exists memo_export_font_size   int  default 11;
