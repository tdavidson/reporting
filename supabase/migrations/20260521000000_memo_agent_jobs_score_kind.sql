-- Memo Agent — standalone score job
--
-- Scoring previously ran only as the tail of the draft_review job, so the
-- only way to (re)score a memo was to re-run the entire draft pipeline.
-- Adding 'score' as its own job kind lets the partner run scoring directly
-- against an existing memo_draft_output — useful when the inline score
-- failed, or after editing the rubric.

alter table memo_agent_jobs
  drop constraint memo_agent_jobs_kind_check;

alter table memo_agent_jobs
  add constraint memo_agent_jobs_kind_check
  check (kind in ('ingest', 'ingest_synthesis', 'research', 'qa', 'draft', 'draft_review', 'score', 'render'));
