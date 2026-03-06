-- Auth hook: enforce allowed_signups whitelist at the database level.
-- This runs before any user is created (including direct signUp calls),
-- preventing whitelist bypass via the public Supabase client.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  user_email text;
  user_domain text;
  is_allowed boolean;
begin
  user_email := lower(event->'user'->>'email');

  -- If no email, block signup
  if user_email is null or user_email = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Email is required.'
      )
    );
  end if;

  user_domain := split_part(user_email, '@', 2);

  -- Check if exact email or wildcard domain pattern is in allowed_signups
  select exists(
    select 1 from public.allowed_signups
    where email_pattern = user_email
       or email_pattern = '*@' || user_domain
  ) into is_allowed;

  if not is_allowed then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This email is not authorized to sign up.'
      )
    );
  end if;

  -- Allow signup
  return '{}'::jsonb;
end;
$$;

-- Grant execute to supabase_auth_admin (required for auth hooks)
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- Revoke from public for security
revoke execute on function public.hook_before_user_created(jsonb) from public;
