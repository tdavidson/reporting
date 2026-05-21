-- Memo Agent — split ingest into two jobs
--
-- Ingest does per-document AI extraction (one call per doc in parallel) and
-- a separate cross-document synthesis call (gap analysis + cross-doc flags).
-- For large data rooms the combined run blows past Vercel's 300s function
-- ceiling. We split the work into two memo_agent_jobs rows:
--
--   kind = 'ingest'            — per-doc fan-out + persist documents to draft
--   kind = 'ingest_synthesis'  — reads the draft, runs synthesis, updates draft
--
-- The ingest job auto-enqueues the synthesis job on success. Each gets its
-- own 300s budget, and per-doc results are durable even if synthesis fails.

alter table memo_agent_jobs
  drop constraint memo_agent_jobs_kind_check;

alter table memo_agent_jobs
  add constraint memo_agent_jobs_kind_check
  check (kind in ('ingest', 'ingest_synthesis', 'research', 'qa', 'draft', 'render'));
