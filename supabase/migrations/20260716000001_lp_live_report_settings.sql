-- Fund-level LP report header + footer, for the LIVE LP report and its report cards.
--
-- A snapshot stored its own `description` (header paragraph) and `footer_note` on the
-- snapshot row — fine when the snapshot WAS the report. The live report has no snapshot, so
-- the header and footer it prints with belong to the fund: set them once, and every live
-- report card uses them until changed.

alter table public.fund_settings
  add column if not exists lp_report_description text,
  add column if not exists lp_report_footer text;

comment on column public.fund_settings.lp_report_description is
  'Header paragraph printed on LIVE LP report cards. The snapshot equivalent is lp_snapshots.description.';
comment on column public.fund_settings.lp_report_footer is
  'Footer note printed on LIVE LP report cards. The snapshot equivalent is lp_snapshots.footer_note.';

-- Seed the fund-level header/footer from the fund's most recent snapshot, so a fund that
-- already curated its snapshot's header/footer doesn't start the live report blank. Only fills
-- columns that are still null, and pulls each from the latest snapshot that actually set it.
update public.fund_settings fs
set
  lp_report_description = coalesce(fs.lp_report_description, (
    select ls.description from public.lp_snapshots ls
    where ls.fund_id = fs.fund_id and ls.description is not null and btrim(ls.description) <> ''
    order by ls.as_of_date desc nulls last, ls.created_at desc
    limit 1)),
  lp_report_footer = coalesce(fs.lp_report_footer, (
    select ls.footer_note from public.lp_snapshots ls
    where ls.fund_id = fs.fund_id and ls.footer_note is not null and btrim(ls.footer_note) <> ''
    order by ls.as_of_date desc nulls last, ls.created_at desc
    limit 1))
where fs.lp_report_description is null or fs.lp_report_footer is null;
