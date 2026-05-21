-- Memo Agent — split draft into draft + draft_review
--
-- Stage 4 drafting now runs as: outline → parallel section fills → review.
-- The review pass uses a (typically stronger) model to edit the first draft.
-- Folding review into the draft job would push outline + fills + review +
-- score past Vercel's 300s ceiling, so review + score run as their own job:
--
--   kind = 'draft'         — outline + parallel section fills, persist
--   kind = 'draft_review'  — review/edit pass + rubric scoring
--
-- The draft job auto-enqueues the draft_review job on success. Each gets its
-- own 300s budget.

alter table memo_agent_jobs
  drop constraint memo_agent_jobs_kind_check;

alter table memo_agent_jobs
  add constraint memo_agent_jobs_kind_check
  check (kind in ('ingest', 'ingest_synthesis', 'research', 'qa', 'draft', 'draft_review', 'render'));
