-- What was emailed to which LP, and whether it arrived at the provider.
--
-- Until now nothing recorded an LP send. The send route returned a count to the browser and
-- forgot it, so "was this partner emailed the Q3 statement?" had no answer, and "was this call
-- notice ever sent?" had none either. The reminders cron got a delivery log a week ago
-- (reminder_deliveries) for the same reason; this is the LP-facing one, and it is one table for
-- every kind of send so the question is answered the same way whatever went out.
--
-- One row per email, not per item: a statement sent to three LPs is three rows, each with the
-- address it went To and the authorized users Cc'd. `item_id` points at whatever was sent (a
-- register line for a notice or receipt, a document, a letter, a snapshot, a message) and `kind`
-- says which table that is. `provider_message_id` is what the provider handed back, for chasing
-- a bounce in its dashboard.
create table public.lp_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  fund_id             uuid not null references funds(id) on delete cascade,
  -- notice | receipt | statement | letter | snapshot | document | announcement | reply
  kind                text not null check (kind in ('notice', 'receipt', 'statement', 'letter', 'snapshot', 'document', 'announcement', 'reply')),
  item_id             uuid,
  lp_investor_id      uuid references lp_investors(id) on delete set null,
  lp_entity_id        uuid references lp_entities(id) on delete set null,
  to_email            text not null,
  cc_emails           text[] not null default '{}',
  subject             text,
  provider            text,
  provider_message_id text,
  status              text not null default 'sent' check (status in ('sent', 'failed')),
  error               text,
  sent_by             uuid,
  sent_at             timestamptz not null default now()
);

create index lp_deliveries_fund_item_idx on public.lp_deliveries (fund_id, kind, item_id);
create index lp_deliveries_fund_investor_idx on public.lp_deliveries (fund_id, lp_investor_id, sent_at desc);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
grant select on public.lp_deliveries to anon;
grant select, insert, update, delete on public.lp_deliveries to authenticated, service_role;

-- 2. RLS — the schema-wide default is "RLS on".
alter table public.lp_deliveries enable row level security;

-- 3. Policies — lp_relations, gated on the portal, exactly like the share tables it records the
--    sending of (lib/access/table-domains.ts). Who was emailed what is a relationship fact.
create policy "lp_deliveries read needs lp_relations"
  on public.lp_deliveries for select to authenticated
  using (fund_id = any(public.fund_ids_readable('lp_relations', 'lp_portal')));
create policy "lp_deliveries insert needs lp_relations write"
  on public.lp_deliveries for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_deliveries update needs lp_relations write"
  on public.lp_deliveries for update to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')))
  with check (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
create policy "lp_deliveries delete needs lp_relations write"
  on public.lp_deliveries for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('lp_relations', 'lp_portal')));
