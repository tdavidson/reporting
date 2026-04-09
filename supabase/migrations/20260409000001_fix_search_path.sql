-- Fix: Function Search Path Mutable (Supabase Security Advisor warnings)
-- Both functions lacked SET search_path, exposing them to search_path injection.

-- Fix 1: set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix 2: count_unread_notes
CREATE OR REPLACE FUNCTION public.count_unread_notes(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.company_notes cn
  WHERE cn.fund_id IN (SELECT fund_id FROM public.fund_members WHERE user_id = p_user_id)
    AND cn.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.note_reads nr WHERE nr.note_id = cn.id AND nr.user_id = p_user_id
    );
$$;
