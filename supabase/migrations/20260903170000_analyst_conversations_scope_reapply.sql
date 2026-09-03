-- Re-apply 20260716000007_analyst_conversations_scope.sql.
--
-- That migration never reached production: the remote migration history had drifted from the
-- CLI's view, later files were applied by hand, and this one was skipped. With no `scope`
-- column, every conversation insert since the unified Analyst shipped failed silently
-- (persistConversation returns null on error) and the history list's `.is('scope', null)`
-- filter errored, so /start showed "No previous conversations" for weeks.
--
-- Every statement is idempotent, so this is safe on a database where the original DID run.
-- The original file is left untouched (historical migrations are never edited).
alter table analyst_conversations
  add column if not exists scope text;

comment on column analyst_conversations.scope is
  'Domain scope for a conversation that is not company- or deal-scoped: ''accounting:<vehicle>'', ''lps'', ''diligence''. NULL = portfolio-wide.';

-- Mirrors idx_analyst_conv_user_company / _user_deal: every read is "this user''s threads in this
-- scope, newest first".
create index if not exists idx_analyst_conv_user_scope
  on analyst_conversations (user_id, scope, updated_at desc);

-- No grants needed: this ALTERs an existing table, whose grants and RLS policies
-- (20260309100003_tighten_rls_writers.sql) already cover it and are column-agnostic.
