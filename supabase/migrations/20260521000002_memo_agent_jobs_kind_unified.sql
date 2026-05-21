-- Memo Agent — unify memo_agent_jobs.kind across all job types
--
-- The kind CHECK constraint was rebuilt independently on two divergent
-- branches:
--   * 20260519000000_call_transcripts.sql        added 'transcribe'
--   * 20260520000000_memo_agent_jobs_draft_review added 'draft_review'
--   * 20260521000000_memo_agent_jobs_score_kind   added 'score'
-- Each did `drop constraint; add constraint` with only the kinds known on
-- its own branch, so whichever migration applied last silently dropped the
-- others' kinds. This migration runs after all of them and re-establishes
-- the constraint with the full union, so every job kind is permitted
-- regardless of apply order.

alter table memo_agent_jobs
  drop constraint if exists memo_agent_jobs_kind_check;

alter table memo_agent_jobs
  add constraint memo_agent_jobs_kind_check
  check (kind in (
    'ingest',
    'ingest_synthesis',
    'research',
    'qa',
    'draft',
    'draft_review',
    'score',
    'render',
    'transcribe'
  ));
