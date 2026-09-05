-- A company owns metrics, updates, documents, notes and investment transactions, so those
-- relationships cascade. Reporting emails, their review history, and the diligence deal that
-- produced an investment are historical records in their own right: deleting a company should
-- retain them and remove only the link to the deleted portfolio record.

alter table public.inbound_emails
  drop constraint if exists inbound_emails_company_id_fkey,
  add constraint inbound_emails_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete set null;

alter table public.parsing_reviews
  drop constraint if exists parsing_reviews_company_id_fkey,
  add constraint parsing_reviews_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete set null;

alter table public.diligence_deals
  drop constraint if exists diligence_deals_promoted_company_id_fkey,
  add constraint diligence_deals_promoted_company_id_fkey
    foreign key (promoted_company_id) references public.companies(id) on delete set null;
