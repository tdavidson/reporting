-- Tighten RLS on all fund-scoped tables so that viewers (e.g. demo users)
-- cannot write data even via direct database access.
-- Pattern: all fund members can SELECT; only admin + member roles can write.

-- Helper: returns true if the current user has write access (admin or member) for a fund.
create or replace function public.is_fund_writer(check_fund_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from fund_members
    where fund_id = check_fund_id
      and user_id = auth.uid()
      and role in ('admin', 'member')
  );
$$;

-- ============================================================
-- companies
-- ============================================================
drop policy if exists "Fund members can manage companies" on companies;

create policy "Fund members can read companies"
  on companies for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert companies"
  on companies for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update companies"
  on companies for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete companies"
  on companies for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- metrics
-- ============================================================
drop policy if exists "Fund members can manage metrics" on metrics;

create policy "Fund members can read metrics"
  on metrics for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert metrics"
  on metrics for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update metrics"
  on metrics for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete metrics"
  on metrics for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- metric_values
-- ============================================================
drop policy if exists "Fund members can manage metric values" on metric_values;

create policy "Fund members can read metric values"
  on metric_values for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert metric values"
  on metric_values for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update metric values"
  on metric_values for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete metric values"
  on metric_values for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- inbound_emails
-- ============================================================
drop policy if exists "Fund members can manage emails" on inbound_emails;

create policy "Fund members can read emails"
  on inbound_emails for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert emails"
  on inbound_emails for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update emails"
  on inbound_emails for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete emails"
  on inbound_emails for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- parsing_reviews
-- ============================================================
drop policy if exists "Fund members can manage reviews" on parsing_reviews;

create policy "Fund members can read reviews"
  on parsing_reviews for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert reviews"
  on parsing_reviews for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update reviews"
  on parsing_reviews for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete reviews"
  on parsing_reviews for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- investment_transactions
-- ============================================================
drop policy if exists "Fund members can manage investment transactions" on investment_transactions;

create policy "Fund members can read investment transactions"
  on investment_transactions for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert investment transactions"
  on investment_transactions for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update investment transactions"
  on investment_transactions for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete investment transactions"
  on investment_transactions for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- company_documents
-- ============================================================
drop policy if exists "Fund members can access company documents" on company_documents;

create policy "Fund members can read company documents"
  on company_documents for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert company documents"
  on company_documents for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update company documents"
  on company_documents for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete company documents"
  on company_documents for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- email_requests
-- ============================================================
drop policy if exists "Fund members can manage email_requests" on email_requests;

create policy "Fund members can read email requests"
  on email_requests for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert email requests"
  on email_requests for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update email requests"
  on email_requests for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete email requests"
  on email_requests for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- company_notes
-- ============================================================
drop policy if exists "Fund members can manage company notes" on company_notes;

create policy "Fund members can read company notes"
  on company_notes for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert company notes"
  on company_notes for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update company notes"
  on company_notes for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete company notes"
  on company_notes for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- authorized_senders
-- ============================================================
drop policy if exists "Fund members can manage senders" on authorized_senders;
drop policy if exists "Fund members can manage authorized_senders" on authorized_senders;

create policy "Fund members can read senders"
  on authorized_senders for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund writers can insert senders"
  on authorized_senders for insert
  with check (public.is_fund_writer(fund_id));

create policy "Fund writers can update senders"
  on authorized_senders for update
  using (public.is_fund_writer(fund_id));

create policy "Fund writers can delete senders"
  on authorized_senders for delete
  using (public.is_fund_writer(fund_id));

-- ============================================================
-- Tables below may not exist in all environments.
-- Wrap in DO blocks to skip gracefully.
-- ============================================================

-- fund_notes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fund_notes') THEN
    DROP POLICY IF EXISTS "Fund members can manage fund notes" ON fund_notes;
    CREATE POLICY "Fund members can read fund notes" ON fund_notes FOR SELECT
      USING (fund_id = ANY(public.get_my_fund_ids()));
    CREATE POLICY "Fund writers can insert fund notes" ON fund_notes FOR INSERT
      WITH CHECK (public.is_fund_writer(fund_id));
    CREATE POLICY "Fund writers can update fund notes" ON fund_notes FOR UPDATE
      USING (public.is_fund_writer(fund_id));
    CREATE POLICY "Fund writers can delete fund notes" ON fund_notes FOR DELETE
      USING (public.is_fund_writer(fund_id));
  END IF;
END $$;

-- analyst_conversations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analyst_conversations') THEN
    DROP POLICY IF EXISTS "Fund members can manage analyst conversations" ON analyst_conversations;
    CREATE POLICY "Fund members can read analyst conversations" ON analyst_conversations FOR SELECT
      USING (fund_id = ANY(public.get_my_fund_ids()));
    CREATE POLICY "Fund writers can insert analyst conversations" ON analyst_conversations FOR INSERT
      WITH CHECK (public.is_fund_writer(fund_id));
    CREATE POLICY "Fund writers can update analyst conversations" ON analyst_conversations FOR UPDATE
      USING (public.is_fund_writer(fund_id));
    CREATE POLICY "Fund writers can delete analyst conversations" ON analyst_conversations FOR DELETE
      USING (public.is_fund_writer(fund_id));
  END IF;
END $$;

-- company_summaries
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'company_summaries') THEN
    DROP POLICY IF EXISTS "Fund members can manage summaries" ON company_summaries;
    CREATE POLICY "Fund members can read summaries" ON company_summaries FOR SELECT
      USING (fund_id = ANY(public.get_my_fund_ids()));
    CREATE POLICY "Fund writers can insert summaries" ON company_summaries FOR INSERT
      WITH CHECK (public.is_fund_writer(fund_id));
    CREATE POLICY "Fund writers can update summaries" ON company_summaries FOR UPDATE
      USING (public.is_fund_writer(fund_id));
    CREATE POLICY "Fund writers can delete summaries" ON company_summaries FOR DELETE
      USING (public.is_fund_writer(fund_id));
  END IF;
END $$;

-- lp_letters (templates already admin-only, but letters allow all members to write)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lp_letters') THEN
    DROP POLICY IF EXISTS "Fund members can manage letters" ON lp_letters;
    CREATE POLICY "Fund writers can insert letters" ON lp_letters FOR INSERT
      WITH CHECK (public.is_fund_writer(fund_id));
    CREATE POLICY "Fund writers can update letters" ON lp_letters FOR UPDATE
      USING (public.is_fund_writer(fund_id));
    CREATE POLICY "Fund writers can delete letters" ON lp_letters FOR DELETE
      USING (public.is_fund_writer(fund_id));
  END IF;
END $$;
