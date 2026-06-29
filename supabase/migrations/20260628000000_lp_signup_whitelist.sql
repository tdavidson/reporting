-- LP access is whitelisted by the LP invite list (lp_accounts), NOT by the GP
-- allowed_signups whitelist. Recreate the before-user-created auth hook to allow
-- a signup when the email is an invited/active LP, in addition to the existing
-- GP allowed_signups check. LP emails are never added to allowed_signups.
--
-- For this to authorize an invite, the lp_account must exist BEFORE the invite is
-- sent — the LP invite routes create it first.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
  user_domain text;
  is_allowed boolean;
begin
  user_email := lower(event->'user'->>'email');

  if user_email is null or user_email = '' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Email is required.'));
  end if;

  user_domain := split_part(user_email, '@', 2);

  select
    -- GP access: exact email or wildcard domain in the GP whitelist.
    exists (
      select 1 from public.allowed_signups
      where email_pattern = user_email
         or email_pattern = '*@' || user_domain
    )
    -- LP access: the email is on the LP invite list.
    or exists (
      select 1 from public.lp_accounts where lower(email) = user_email
    )
  into is_allowed;

  if not is_allowed then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This email is not authorized to sign up.'));
  end if;

  return '{}'::jsonb;
end;
$$;

-- The hook is invoked as supabase_auth_admin; grant it read on the tables it
-- consults (lp_accounts has RLS on; mirror the allowed_signups grant pattern).
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant select on table public.lp_accounts to supabase_auth_admin;
