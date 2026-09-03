-- Two fixes from the first live sample backfill.
--
-- 1. company_updates_stats timed out: it opened raw_payload for every eligible email to count
--    attachments. inbound_emails.attachments_count already holds that number.
-- 2. Exact-substring fallback matched inside words ("ARR" → "warrant"). A needle that is purely
--    alphanumeric now matches on word boundaries (\m…\M); needles with symbols or punctuation —
--    identifiers like ACME-7781, $1.2M — keep plain substring matching, which is what they need.
-- 3. SECURITY: the earlier migration created company_updates_search_run without revoking EXECUTE
--    from anon/authenticated (the default grant), so a signed-in user could call it with any
--    fund id. Revoked below; the public entry point company_updates_search was already locked.

create or replace function public.company_updates_stats(p_fund_id uuid, p_current_parser_version text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select ie.id, coalesce(ie.attachments_count, 0) as attachments_count
      from inbound_emails ie
     where ie.fund_id = p_fund_id
       and ie.company_id is not null
       and coalesce(ie.routed_to, 'reporting') = 'reporting'
  )
  select jsonb_build_object(
    'eligible_emails', (select count(*) from eligible),
    'captured_updates', (select count(*) from company_updates u where u.fund_id = p_fund_id),
    'updates_by_status', coalesce((
      select jsonb_object_agg(s, n) from (
        select extraction_status s, count(*) n from company_updates where fund_id = p_fund_id group by 1
      ) x), '{}'::jsonb),
    'updates_stale_parser', case when p_current_parser_version is null then null else (
      select count(*) from company_updates u
       where u.fund_id = p_fund_id and u.parser_version is distinct from p_current_parser_version
    ) end,
    'source_attachments', (select coalesce(sum(attachments_count), 0) from eligible),
    'artifact_rows', (select count(*) from company_update_artifacts a where a.fund_id = p_fund_id),
    'artifacts_by_format_status', coalesce((
      select jsonb_agg(jsonb_build_object('format', f, 'status', s, 'count', n) order by f, s) from (
        select coalesce(detected_content_type, declared_content_type, 'unknown') f, extraction_status s, count(*) n
          from company_update_artifacts where fund_id = p_fund_id group by 1, 2
      ) x), '[]'::jsonb),
    'ocr', coalesce((
      select jsonb_object_agg(s, n) from (
        select ocr_status s, count(*) n from company_update_artifacts
         where fund_id = p_fund_id and ocr_status <> 'not_needed' group by 1
      ) x), '{}'::jsonb),
    'parser_failures_by_version', coalesce((
      select jsonb_agg(jsonb_build_object('parser', p, 'parser_version', v, 'count', n) order by v, p) from (
        select parser p, parser_version v, count(*) n from company_update_artifacts
         where fund_id = p_fund_id and extraction_status = 'failed' group by 1, 2
      ) x), '[]'::jsonb),
    'artifacts_without_chunks', (
      select count(*) from company_update_artifacts a
       where a.fund_id = p_fund_id and a.extracted_text <> ''
         and not exists (select 1 from company_update_chunks c where c.artifact_id = a.id)
    ),
    'stale_chunks', (
      select count(*) from company_update_chunks c
       where c.fund_id = p_fund_id and c.artifact_id is not null
         and exists (
           select 1 from company_update_artifacts a
            where a.id = c.artifact_id and a.parser_version is distinct from c.parser_version
         )
    ),
    'latest_backfill', (
      select to_jsonb(j) - 'plan_cursor' from company_update_backfill_jobs j
       where j.fund_id = p_fund_id order by j.created_at desc limit 1
    )
  );
$$;

revoke execute on function public.company_updates_stats(uuid, text) from anon, authenticated, public;
grant execute on function public.company_updates_stats(uuid, text) to service_role;

-- Exact mode: word-boundary matching for alphanumeric needles.
create or replace function public.company_updates_search_run(
  p_fund_id uuid,
  p_query text,
  p_mode text,                 -- 'none' | 'lexical' | 'exact'
  p_company_ids uuid[],
  p_since date,
  p_until date,
  p_latest_per_company boolean,
  p_order text,                -- 'relevance' | 'newest'
  p_limit int,
  p_cursor jsonb,
  p_excerpts int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tsq tsquery := case when p_mode = 'lexical' then websearch_to_tsquery('english', p_query) end;
  v_needle text := btrim(p_query, ' "''');
  v_pat text := case when p_mode = 'exact'
    then '%' || replace(replace(replace(v_needle, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  -- Plain alphanumeric needles match whole words; anything with symbols stays a raw substring.
  v_word boolean := p_mode = 'exact' and v_needle ~ '^[[:alnum:]]+$';
  v_re text := case when v_word then '\m' || v_needle || '\M' end;
  v_c_rank float8 := (p_cursor ->> 'rank')::float8;
  v_c_received timestamptz := (p_cursor ->> 'received_at')::timestamptz;
  v_c_id uuid := (p_cursor ->> 'id')::uuid;
  v_result jsonb;
begin
  with base as (
    select cu.id, cu.company_id, cu.received_at
      from company_updates cu
     where cu.fund_id = p_fund_id
       and (p_company_ids is null or cu.company_id = any(p_company_ids))
       and (p_since is null or cu.received_at >= p_since::timestamptz)
       -- Inclusive `until`: everything before the start of the following day.
       and (p_until is null or cu.received_at < (p_until + 1)::timestamptz)
  ),
  -- latest_per_company selects each company's newest eligible update FIRST, so a query applied
  -- afterwards can only match a company's current update — never an older one in its place.
  scope as (
    select b.* from base b
     where not p_latest_per_company
        or b.id = (
          select b2.id from base b2 where b2.company_id = b.company_id
           order by b2.received_at desc, b2.id desc limit 1
        )
  ),
  hits as (
    select c.update_id, max(ts_rank_cd(c.search, v_tsq)) as rank
      from company_update_chunks c
      join scope s on s.id = c.update_id
     where c.fund_id = p_fund_id
       and p_mode = 'lexical' and c.search @@ v_tsq
     group by c.update_id
    union all
    select c.update_id, 1.0::float8
      from company_update_chunks c
      join scope s on s.id = c.update_id
     where c.fund_id = p_fund_id
       and p_mode = 'exact' and (case when v_word then c.content ~* v_re else c.content ilike v_pat escape '\' end)
     group by c.update_id
  ),
  matched as (
    select s.id, s.company_id, s.received_at,
           case when p_mode = 'none' then 0::float8 else h.rank end as rank
      from scope s
      left join hits h on h.update_id = s.id
     where p_mode = 'none' or h.update_id is not null
  ),
  after_cursor as (
    select m.* from matched m
     where p_cursor is null
        or (p_order = 'relevance' and (m.rank, m.received_at, m.id) < (v_c_rank, v_c_received, v_c_id))
        or (p_order = 'newest' and (m.received_at, m.id) < (v_c_received, v_c_id))
  ),
  page_plus as (
    select a.*, row_number() over (
             order by case when p_order = 'relevance' then a.rank end desc, a.received_at desc, a.id desc
           ) as rn
      from after_cursor a
     order by case when p_order = 'relevance' then a.rank end desc, a.received_at desc, a.id desc
     limit p_limit + 1
  ),
  page as (select * from page_plus where rn <= p_limit),
  excerpts as (
    select c.update_id,
           jsonb_agg(jsonb_build_object(
             'chunk_id', c.id,
             'artifact_id', c.artifact_id,
             'filename', a.filename,
             'chunk_kind', c.chunk_kind,
             'ordinal', c.ordinal,
             'locator', c.locator,
             'text', case
               when p_mode = 'lexical' then ts_headline('english', c.content, v_tsq,
                 'MaxFragments=2, MaxWords=28, MinWords=12, StartSel=[[, StopSel=]], FragmentDelimiter= … ')
               when p_mode = 'exact' then substr(c.content,
                 greatest(1, position(lower(v_needle) in lower(c.content)) - 120), 320)
               else left(c.content, 300)
             end
           ) order by c.rank desc, c.ordinal) filter (where c.rn <= p_excerpts) as items
      from (
        select c.*,
               case when p_mode = 'lexical' then ts_rank_cd(c.search, v_tsq) else 0 end as rank,
               row_number() over (
                 partition by c.update_id
                 order by case when p_mode = 'lexical' then ts_rank_cd(c.search, v_tsq) else 0 end desc,
                          case c.chunk_kind when 'body_current' then 0 when 'attachment' then 1 when 'subject' then 2 else 3 end,
                          c.ordinal
               ) as rn
          from company_update_chunks c
          join page p on p.id = c.update_id
         where c.fund_id = p_fund_id
           and (
             (p_mode = 'lexical' and c.search @@ v_tsq)
             or (p_mode = 'exact' and (case when v_word then c.content ~* v_re else c.content ilike v_pat escape '\' end))
             or (p_mode = 'none' and c.chunk_kind in ('body_current', 'body_original') and c.ordinal = 0)
           )
      ) c
      left join company_update_artifacts a on a.id = c.artifact_id
     group by c.update_id
  ),
  rows_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'update_id', u.id,
             'company_id', u.company_id,
             'company_name', co.name,
             'source_email_id', u.source_email_id,
             'received_at', u.received_at,
             'subject', u.subject,
             'sender_name', u.sender_name,
             'sender_email', u.sender_email,
             'forwarded_sender_name', u.forwarded_sender_name,
             'forwarded_sender_email', u.forwarded_sender_email,
             'period_label', u.period_label,
             'period_source', u.period_source,
             'extraction_status', u.extraction_status,
             'warnings', u.warnings,
             'rank', p.rank,
             'excerpts', coalesce(e.items, '[]'::jsonb),
             'artifacts', coalesce((
               select jsonb_agg(jsonb_build_object(
                 'id', a.id, 'ordinal', a.ordinal, 'filename', a.filename,
                 'extraction_status', a.extraction_status, 'ocr_status', a.ocr_status
               ) order by a.ordinal)
               from company_update_artifacts a where a.update_id = u.id
             ), '[]'::jsonb)
           ) order by p.rn), '[]'::jsonb) as results
      from page p
      join company_updates u on u.id = p.id
      join companies co on co.id = u.company_id
      left join excerpts e on e.update_id = p.id
  ),
  last_row as (select * from page where rn = p_limit)
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'results', (select results from rows_json),
    'next_cursor', case
      when (select count(*) from page_plus) > p_limit then (
        select jsonb_build_object('mode', p_mode, 'rank', l.rank, 'received_at', l.received_at, 'id', l.id)
          from last_row l
      )
    end,
    'match_mode', p_mode,
    'order', p_order
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.company_updates_search_run(uuid, text, text, uuid[], date, date, boolean, text, int, jsonb, int) from anon, authenticated, public;
grant execute on function public.company_updates_search_run(uuid, text, text, uuid[], date, date, boolean, text, int, jsonb, int) to service_role;
