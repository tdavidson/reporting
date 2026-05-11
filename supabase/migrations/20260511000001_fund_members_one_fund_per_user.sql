-- Enforce the load-bearing architectural assumption that one user belongs to
-- at most one fund. The existing unique(fund_id, user_id) constraint only
-- prevents duplicate memberships within the same fund — it allows a single
-- user_id to appear across multiple funds, which would break every API route
-- that resolves the caller's fund via `.from('fund_members')...maybeSingle()`.
--
-- If this migration fails to apply, there is at least one user with more than
-- one fund_members row. Resolve manually by removing the extra membership(s)
-- before retrying.

alter table fund_members
  add constraint fund_members_user_id_unique unique (user_id);
