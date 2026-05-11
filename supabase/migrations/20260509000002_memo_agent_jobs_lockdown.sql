-- Security follow-up: lock memo_agent_claim_next_job to the service role.
--
-- The RPC is SECURITY DEFINER and returns a full memo_agent_jobs row, which
-- bypasses the table's RLS. Postgres/PostgREST exposes every public-schema
-- function to the `anon` and `authenticated` roles by default, so without
-- this REVOKE any logged-in tenant can call
--
--     supabase.rpc('memo_agent_claim_next_job')
--
-- and receive another tenant's fund_id / deal_id / draft_id / payload.
--
-- The only legitimate caller (app/api/cron/memo-agent-worker/route.ts) uses
-- the service-role client, so removing public/anon/authenticated EXECUTE
-- preserves correct behavior while eliminating the cross-tenant leak.

revoke execute on function public.memo_agent_claim_next_job() from public;
revoke execute on function public.memo_agent_claim_next_job() from anon;
revoke execute on function public.memo_agent_claim_next_job() from authenticated;
-- service_role retains EXECUTE via the default GRANT.
