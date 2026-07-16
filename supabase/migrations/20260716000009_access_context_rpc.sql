-- One round trip to answer "what may this user reach?".
--
-- The access gate runs in middleware on EVERY /api request, so its cost is the app's cost. Built
-- from the client it was four PostgREST calls (membership, settings, grants, defaults) — two
-- sequential round trips, because grants and defaults need the fund_id the first call returns.
-- This collapses them into one.
--
-- Resolving live is deliberate and is what we're paying for: revoking a grant takes effect on the
-- caller's next request, with no token to hunt down and no cache to wait out. So make the one call
-- cheap rather than make it less often.
--
-- See docs/plan-access-control.md and lib/access/effective.ts.

create or replace function public.access_context(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_result jsonb;
begin
  -- WHOSE context may you ask for? Your own, always. Someone else's only when there is no JWT
  -- identity at all — i.e. the service role, which is server-side code that has already
  -- established who it is acting for. A signed-in user passing another user's id is refused
  -- rather than silently answered, which would make this function an access-map oracle.
  --
  -- EXECUTE is revoked from anon below, so "no JWT identity" cannot be reached from the public
  -- internet: an anonymous caller can't invoke this at all.
  v_target := coalesce(p_user_id, auth.uid());
  if auth.uid() is not null and v_target <> auth.uid() then
    raise exception 'access_context: you may only resolve your own access';
  end if;
  if v_target is null then
    return null;
  end if;

  select jsonb_build_object(
    'fund_id', m.fund_id,
    'role', m.role,
    'features', coalesce(fs.feature_visibility, '{}'::jsonb),
    'grants', coalesce(
      (select jsonb_object_agg(a.domain, a.level)
         from fund_member_access a
        where a.fund_id = m.fund_id and a.user_id = m.user_id),
      '{}'::jsonb),
    'defaults', coalesce(
      (select jsonb_object_agg(d.domain, d.level)
         from fund_domain_defaults d
        where d.fund_id = m.fund_id),
      '{}'::jsonb)
  )
  into v_result
  from fund_members m
  left join fund_settings fs on fs.fund_id = m.fund_id
  where m.user_id = v_target;

  -- NULL = not a member of any fund. The caller decides what that means (the middleware lets the
  -- route answer; a route returns its own 403).
  return v_result;
end;
$$;

-- SECURITY DEFINER reads fund_members/fund_settings/grants past RLS, so who may call it is the
-- whole control: never anonymously.
revoke execute on function public.access_context(uuid) from public, anon;
grant execute on function public.access_context(uuid) to authenticated, service_role;

comment on function public.access_context(uuid) is
  'Resolve a user''s access inputs (fund, role, feature switches, grants, defaults) in one call. Own user only, unless called by the service role. See lib/access/effective.ts.';
