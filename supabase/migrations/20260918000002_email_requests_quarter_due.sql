-- A data request now records WHICH quarter it asks about and WHEN responses are due, so the
-- ops-reminders cron can tell "Q3 not sent yet" from "Q3 sent, 4 companies late".
-- quarter_label (free text, and never actually sent by the composer) stays for display.

alter table public.email_requests
  add column if not exists due_date date,
  add column if not exists quarter smallint,
  add column if not exists year int;

alter table public.email_requests drop constraint if exists email_requests_quarter_check;
alter table public.email_requests
  add constraint email_requests_quarter_check check (quarter is null or quarter between 1 and 4);

-- Best-effort backfill from "Q3 2026" in the label or subject. Test sends (a single recipient
-- named 'Test') are skipped so they never count as "the Q3 request was sent". The Test check is
-- guarded by jsonb_typeof inside a CASE — AND doesn't guarantee short-circuit in Postgres, and
-- jsonb_array_length raises on a non-array, which would abort the whole migration.
update public.email_requests
set quarter = substring(coalesce(quarter_label, '') || ' ' || subject from 'Q([1-4])\s*\d{4}')::smallint,
    year    = substring(coalesce(quarter_label, '') || ' ' || subject from 'Q[1-4]\s*(\d{4})')::int
where quarter is null
  and (coalesce(quarter_label, '') || ' ' || subject) ~ 'Q[1-4]\s*\d{4}'
  and not coalesce(
    case when jsonb_typeof(recipients) = 'array'
         then jsonb_array_length(recipients) = 1 and recipients->0->>'companyName' = 'Test'
    end,
    false);

create index if not exists email_requests_fund_quarter_idx
  on public.email_requests (fund_id, year, quarter);
