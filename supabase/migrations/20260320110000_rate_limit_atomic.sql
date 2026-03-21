-- Atomic rate limit check-and-increment function.
-- Deletes expired entries, counts current ones, inserts a new entry,
-- and returns the count — all in a single transaction to prevent TOCTOU races.

create or replace function rate_limit_check(
  p_key text,
  p_limit int,
  p_window_seconds int
) returns int
language plpgsql
security definer
as $$
declare
  v_count int;
  v_window_start timestamptz := now() - (p_window_seconds || ' seconds')::interval;
begin
  -- Clean expired entries
  delete from rate_limit_entries
  where key = p_key and created_at < v_window_start;

  -- Count current entries (before inserting new one)
  select count(*) into v_count
  from rate_limit_entries
  where key = p_key and created_at >= v_window_start;

  -- If already at or over limit, return count + 1 (over limit) without inserting
  if v_count >= p_limit then
    return v_count + 1;
  end if;

  -- Insert new entry
  insert into rate_limit_entries (key, created_at) values (p_key, now());

  return v_count + 1;
end;
$$;
