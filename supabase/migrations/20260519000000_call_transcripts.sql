-- Call transcription ingestion — schema additions.
--
-- Adds support for ingesting Zoom / Google Meet recordings (and pre-made
-- transcript files) into the diligence data room. Transcripts become normal
-- diligence_documents rows so they flow through the existing memo-agent
-- ingest pipeline (see lib/memo-agent/jobs/ingest-job.ts).
--
-- Pieces added here:
--   1. diligence_documents.source_document_id   — links a transcript row back
--                                                 to the recording it was made
--                                                 from (null for direct uploads).
--   2. diligence_documents.external_source      — jsonb describing an external
--                                                 storage location (e.g. Drive
--                                                 file ID + size) for files we
--                                                 chose not to copy into
--                                                 Supabase Storage because they
--                                                 were too large.
--   3. memo_agent_jobs.kind = 'transcribe'      — new job kind.
--   4. memo_agent_jobs.external_job_id          — Deepgram request_id (or other
--                                                 provider's async handle) so
--                                                 the webhook can find the row.
--   5. diligence_call_transcripts               — per-utterance turns with
--                                                 speaker labels and timestamps.
--   6. diligence-recordings storage bucket      — raw audio/video, separate
--                                                 from diligence-documents so
--                                                 retention can differ.

-- ---------------------------------------------------------------------------
-- 1 + 2. Extend diligence_documents.
-- ---------------------------------------------------------------------------

alter table diligence_documents
  add column if not exists source_document_id uuid
    references diligence_documents(id) on delete set null;

alter table diligence_documents
  add column if not exists external_source jsonb;

create index if not exists diligence_documents_source_doc_idx
  on diligence_documents (source_document_id)
  where source_document_id is not null;

-- ---------------------------------------------------------------------------
-- 3 + 4. Extend memo_agent_jobs.
-- ---------------------------------------------------------------------------

-- NOTE: the kind CHECK constraint is intentionally NOT rebuilt here. This
-- branch was cut before `ingest_synthesis` / `draft_review` / `score` were
-- added on main; rebuilding the constraint with only this branch's kinds
-- would (a) fail validation against existing ingest_synthesis rows, and
-- (b) drop the other kinds. The unified constraint — including 'transcribe'
-- — is established by 20260521000002_memo_agent_jobs_kind_unified.sql, which
-- runs after every branch's kind migration.

alter table memo_agent_jobs
  add column if not exists external_job_id text;

create index if not exists memo_agent_jobs_external_job_idx
  on memo_agent_jobs (external_job_id)
  where external_job_id is not null;

-- ---------------------------------------------------------------------------
-- 5. diligence_call_transcripts — structured per-turn data.
-- ---------------------------------------------------------------------------
-- One row per utterance from the transcription provider. Plain-text join of
-- (text) by start_ms gives the full transcript; the structure is what makes
-- diligence citations useful ("the CFO said X at 14:32").

create table public.diligence_call_transcripts (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references diligence_documents(id) on delete cascade,
  deal_id         uuid not null references diligence_deals(id) on delete cascade,
  fund_id         uuid not null references funds(id) on delete cascade,
  speaker         text,                                 -- raw provider label, e.g. "Speaker 0"
  speaker_label   text,                                 -- human-mapped name (set via UI later)
  start_ms        integer not null,
  end_ms          integer not null,
  text            text not null,
  created_at      timestamptz not null default now()
);

create index diligence_call_transcripts_doc_idx
  on diligence_call_transcripts (document_id, start_ms);
create index diligence_call_transcripts_fund_idx
  on diligence_call_transcripts (fund_id);

-- Data API grants (required from 2026-05-30 onward; see CLAUDE.md).
grant select on public.diligence_call_transcripts to anon;
grant select, insert, update, delete on public.diligence_call_transcripts
  to authenticated, service_role;

-- RLS — matches the diligence_documents pattern (fund-scoped via
-- public.get_my_fund_ids() returning uuid[]).
alter table public.diligence_call_transcripts enable row level security;

create policy diligence_call_transcripts_all on public.diligence_call_transcripts
  for all using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

-- ---------------------------------------------------------------------------
-- 6. diligence-recordings storage bucket.
-- ---------------------------------------------------------------------------
-- Path structure: {dealId}/{filename}, mirroring diligence-documents.
-- 2 GB cap — long video recordings can exceed the 100 MB diligence-documents
-- limit. PR 4 enforces a smaller default upload threshold in the app code and
-- routes anything larger to a direct-from-Drive transcription path.

insert into storage.buckets (id, name, public, file_size_limit)
values ('diligence-recordings', 'diligence-recordings', false, 2147483648)
on conflict (id) do nothing;

create policy "Fund members can read diligence recordings"
  on storage.objects for select
  using (
    bucket_id = 'diligence-recordings'
    and exists (
      select 1 from diligence_deals d
      join fund_members fm on fm.fund_id = d.fund_id
      where d.id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
    )
  );

create policy "Fund members can upload diligence recordings"
  on storage.objects for insert
  with check (
    bucket_id = 'diligence-recordings'
    and exists (
      select 1 from diligence_deals d
      join fund_members fm on fm.fund_id = d.fund_id
      where d.id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
    )
  );

create policy "Fund admins can delete diligence recordings"
  on storage.objects for delete
  using (
    bucket_id = 'diligence-recordings'
    and exists (
      select 1 from diligence_deals d
      join fund_members fm on fm.fund_id = d.fund_id
      where d.id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
        and fm.role = 'admin'
    )
  );
