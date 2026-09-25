-- The quarterly-close tables (20260920*), restated in the form lib/access/table-domains.ts and
-- tests/rls-domain-policies.test.ts read. Nothing about who may see what changes.
--
--   * close_allocation_rounding shipped with the accounting gate the registry names, but under
--     policy names with spaces ("close allocation rounding read needs accounting"). Every other
--     table's policies are "<table> <verb> needs <domain>", which is what a later re-gating
--     migration looks for when it drops a table's old policies, and what the test checks. Same
--     conditions, conventional names.
--   * journal_entry_allocations, close_reviews, close_review_checks, accounting_schedules and
--     accounting_schedule_lines are service-role only, and were made so with one revoke and one
--     grant naming several tables. The per-table statements below say the same thing, table by
--     table. Idempotent.
--
-- The migrations that created these tables are applied and stay exactly as they shipped.

do $$
declare
  p record;
begin
  if to_regclass('public.close_allocation_rounding') is null then
    raise exception 'close_tables_registry_form: public.close_allocation_rounding does not exist';
  end if;
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'close_allocation_rounding' loop
    execute format('drop policy if exists %I on public.close_allocation_rounding', p.policyname);
  end loop;
end $$;

alter table public.close_allocation_rounding enable row level security;

create policy "close_allocation_rounding read needs accounting"
  on public.close_allocation_rounding for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "close_allocation_rounding insert needs accounting write"
  on public.close_allocation_rounding for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "close_allocation_rounding update needs accounting write"
  on public.close_allocation_rounding for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "close_allocation_rounding delete needs accounting write"
  on public.close_allocation_rounding for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

-- Service-role only.
revoke all on public.journal_entry_allocations from anon, authenticated;
grant select, insert, update, delete on public.journal_entry_allocations to service_role;
revoke all on public.close_reviews from anon, authenticated;
grant select, insert, update, delete on public.close_reviews to service_role;
revoke all on public.close_review_checks from anon, authenticated;
grant select, insert, update, delete on public.close_review_checks to service_role;
revoke all on public.accounting_schedules from anon, authenticated;
grant select, insert, update, delete on public.accounting_schedules to service_role;
revoke all on public.accounting_schedule_lines from anon, authenticated;
grant select, insert, update, delete on public.accounting_schedule_lines to service_role;
