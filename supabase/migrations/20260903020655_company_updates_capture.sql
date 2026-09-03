-- Company Updates capture foundation.
--
-- This is intentionally only the durable evidence layer. Portfolio-reporting emails are captured
-- independently of configured metric extraction; each attachment has its own status and provenance;
-- bounded chunks are the future search boundary. No AI-generated summaries or classifications live
-- here.

create table public.company_updates (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null default 'email' check (source = 'email'),
  source_route text not null default 'reporting' check (source_route = 'reporting'),
  source_email_id uuid not null unique references public.inbound_emails(id) on delete cascade,
  sender_name text,
  sender_email text,
  forwarded_sender_name text,
  forwarded_sender_email text,
  subject text,
  received_at timestamptz not null,
  period_label text,
  period_year int,
  period_quarter int check (period_quarter is null or period_quarter between 1 and 4),
  period_month int check (period_month is null or period_month between 1 and 12),
  body_original text,
  body_current text,
  body_status text not null default 'complete' check (body_status in ('complete', 'partial', 'failed')),
  body_cleaning_status text not null default 'not_applicable'
    check (body_cleaning_status in ('complete', 'uncertain', 'not_applicable')),
  body_cleaner_version text,
  period_source text check (period_source is null or period_source in ('configured_metric_extraction', 'manual', 'unknown')),
  extraction_status text not null default 'complete' check (extraction_status in ('complete', 'partial', 'failed')),
  warnings jsonb not null default '[]'::jsonb,
  parser_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.company_updates to anon;
grant select, insert, update, delete on public.company_updates to authenticated, service_role;

create index company_updates_company_received_idx
  on public.company_updates (company_id, received_at desc, id desc);
create index company_updates_fund_received_idx
  on public.company_updates (fund_id, received_at desc, id desc);

alter table public.company_updates enable row level security;

create policy "company_updates read needs portfolio"
  on public.company_updates for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "company_updates insert needs portfolio write"
  on public.company_updates for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_updates update needs portfolio write"
  on public.company_updates for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_updates delete needs portfolio write"
  on public.company_updates for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create table public.company_update_artifacts (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  update_id uuid not null references public.company_updates(id) on delete cascade,
  attachment_key text not null,
  ordinal int not null check (ordinal >= 0),
  filename text not null,
  declared_content_type text,
  detected_content_type text,
  storage_path text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  content_sha256 text,
  extracted_text text,
  extraction_status text not null default 'failed' check (extraction_status in ('complete', 'partial', 'failed', 'not_applicable')),
  parser text,
  parser_version text,
  warnings jsonb not null default '[]'::jsonb,
  extraction_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (update_id, attachment_key),
  unique (update_id, ordinal)
);

grant select on public.company_update_artifacts to anon;
grant select, insert, update, delete on public.company_update_artifacts to authenticated, service_role;

create index company_update_artifacts_update_idx
  on public.company_update_artifacts (update_id, ordinal);
create index company_update_artifacts_fund_idx
  on public.company_update_artifacts (fund_id, created_at desc);

alter table public.company_update_artifacts enable row level security;

create policy "company_update_artifacts read needs portfolio"
  on public.company_update_artifacts for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "company_update_artifacts insert needs portfolio write"
  on public.company_update_artifacts for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_update_artifacts update needs portfolio write"
  on public.company_update_artifacts for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_update_artifacts delete needs portfolio write"
  on public.company_update_artifacts for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));

create table public.company_update_chunks (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  update_id uuid not null references public.company_updates(id) on delete cascade,
  artifact_id uuid references public.company_update_artifacts(id) on delete cascade,
  chunk_kind text not null check (chunk_kind in ('body_original', 'body_current', 'attachment')),
  ordinal int not null check (ordinal >= 0),
  locator jsonb not null default '{}'::jsonb,
  content text not null check (char_length(content) between 1 and 12000),
  search tsvector,
  parser_version text not null,
  created_at timestamptz not null default now(),
  unique (update_id, artifact_id, chunk_kind, ordinal)
);

grant select on public.company_update_chunks to anon;
grant select, insert, update, delete on public.company_update_chunks to authenticated, service_role;

create index company_update_chunks_update_idx
  on public.company_update_chunks (update_id, artifact_id, chunk_kind, ordinal);
create index company_update_chunks_fund_idx
  on public.company_update_chunks (fund_id, company_id, created_at desc);
create index company_update_chunks_search_idx
  on public.company_update_chunks using gin (search);

-- `artifact_id` is NULL for body chunks, and ordinary UNIQUE constraints treat NULLs as distinct.
-- This partial index makes body chunk writes idempotent as well as attachment chunk writes.
create unique index company_update_chunks_body_unique_idx
  on public.company_update_chunks (update_id, chunk_kind, ordinal)
  where artifact_id is null;

create or replace function public.company_update_chunks_search_trigger()
returns trigger
language plpgsql
as $$
begin
  new.search := to_tsvector('english', coalesce(new.content, ''));
  return new;
end;
$$;

create trigger company_update_chunks_search_sync
  before insert or update of content on public.company_update_chunks
  for each row execute function public.company_update_chunks_search_trigger();

alter table public.company_update_chunks enable row level security;

create policy "company_update_chunks read needs portfolio"
  on public.company_update_chunks for select to authenticated
  using (fund_id = any(public.fund_ids_readable('portfolio')));
create policy "company_update_chunks insert needs portfolio write"
  on public.company_update_chunks for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_update_chunks update needs portfolio write"
  on public.company_update_chunks for update to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')))
  with check (fund_id = any(public.fund_ids_writable('portfolio')));
create policy "company_update_chunks delete needs portfolio write"
  on public.company_update_chunks for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('portfolio')));
