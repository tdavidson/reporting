-- Company Updates: lifecycle correctness, lexical search, OCR queue, backfill jobs.
--
-- Builds on 20260903020655_company_updates_capture.sql (the tables). This migration adds what the
-- product spec requires beyond storage:
--
--   1. ATOMIC REPLACEMENT. `company_update_replace` upserts the update, its artifacts and every
--      chunk in ONE transaction, deleting artifacts the source no longer has. Application code
--      previously did this as ~6 round trips, so a failure midway could leave chunks for text that
--      no longer existed — exactly the "stale searchable content" the spec forbids.
--   2. PROJECTION FOLLOWS THE SOURCE. A trigger on inbound_emails keeps company_updates consistent
--      with `company_id` and the effective route, whichever code path changed them (manual assign,
--      review resolution, reroute, pipeline). Reassignment MOVES the update; leaving the reporting
--      route REMOVES it; artifacts and chunks cascade.
--   3. WEIGHTED SEARCH. Chunk kinds gain 'subject' and 'artifact_title' (weight A), current body is
--      B, attachment content C, quoted/original body D — the ordering in the spec.
--   4. OCR QUEUE. Artifacts carry an observable `ocr_status`; a claim RPC hands pending work to the
--      worker; an apply RPC merges OCR text and re-derives the update's completeness atomically.
--   5. SEARCH + STATS RPCs. `company_updates_search` does filtering, latest-per-company selection,
--      ranking, exact counting, excerpts and keyset pagination in SQL. Service-role only: every
--      caller passes the fund it already resolved from membership.
--   6. BACKFILL JOBS. Resumable operator job + per-email items, claimed with SKIP LOCKED.
--
-- Everything here is service-role only unless stated. RLS on the three content tables is unchanged.

-- ─── 1. Chunk kinds and weights ───────────────────────────────────────────────────────────────

alter table public.company_update_chunks drop constraint company_update_chunks_chunk_kind_check;
alter table public.company_update_chunks add constraint company_update_chunks_chunk_kind_check
  check (chunk_kind in ('subject', 'artifact_title', 'body_original', 'body_current', 'attachment'));

create or replace function public.company_update_chunks_search_trigger()
returns trigger
language plpgsql
as $$
begin
  new.search := setweight(
    to_tsvector('english', coalesce(new.content, '')),
    case new.chunk_kind
      when 'subject' then 'A'
      when 'artifact_title' then 'A'
      when 'body_current' then 'B'
      when 'attachment' then 'C'
      else 'D'
    end
  );
  return new;
end;
$$;

-- Ordinals can legitimately shift between two captures of the same email (an attachment was
-- deleted from the source). Deferring the uniqueness check lets one transaction renumber them.
alter table public.company_update_artifacts
  drop constraint company_update_artifacts_update_id_ordinal_key;
alter table public.company_update_artifacts
  add constraint company_update_artifacts_update_id_ordinal_key
  unique (update_id, ordinal) deferrable initially deferred;

-- ─── 2. OCR queue state on artifacts ──────────────────────────────────────────────────────────

alter table public.company_update_artifacts
  add column ocr_status text not null default 'not_needed'
    check (ocr_status in ('not_needed', 'pending', 'running', 'complete', 'failed')),
  add column ocr_attempts int not null default 0,
  add column ocr_error text,
  add column ocr_updated_at timestamptz;

create index company_update_artifacts_ocr_pending_idx
  on public.company_update_artifacts (fund_id, created_at)
  where ocr_status in ('pending', 'running');

-- ─── 3. Atomic replacement ────────────────────────────────────────────────────────────────────

-- p_update:   the company_updates columns (source_email_id, company_id, subject, bodies, statuses…)
-- p_artifacts: [{ attachment_key, ordinal, filename, …, chunks: [{ chunk_kind, ordinal, locator, content, parser_version }] }]
-- p_body_chunks: [{ chunk_kind, ordinal, locator, content, parser_version }]  (artifact_id null)
-- Returns { update_id, artifacts: { <attachment_key>: <artifact_id> } }.
create or replace function public.company_update_replace(
  p_fund_id uuid,
  p_update jsonb,
  p_artifacts jsonb default '[]'::jsonb,
  p_body_chunks jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_id uuid := (p_update ->> 'source_email_id')::uuid;
  v_company_id uuid := (p_update ->> 'company_id')::uuid;
  v_email record;
  v_update_id uuid;
  v_artifact jsonb;
  v_artifact_id uuid;
  v_chunk jsonb;
  v_keys text[] := '{}';
  v_map jsonb := '{}'::jsonb;
  v_now timestamptz := now();
begin
  if p_fund_id is null or v_email_id is null or v_company_id is null then
    raise exception 'company_update_replace requires fund_id, source_email_id and company_id' using errcode = '22023';
  end if;

  -- The source row is the authority on route and company, and the lock serialises concurrent
  -- captures of the same email (reprocess racing a backfill).
  select ie.id, ie.company_id, ie.routed_to
    into v_email
    from inbound_emails ie
   where ie.id = v_email_id and ie.fund_id = p_fund_id
     for update;
  if not found then
    raise exception 'Source email % is not in fund %', v_email_id, p_fund_id using errcode = 'P0002';
  end if;
  if coalesce(v_email.routed_to, 'reporting') <> 'reporting' then
    raise exception 'Source email % is routed to %, not portfolio reporting', v_email_id, v_email.routed_to using errcode = '22023';
  end if;
  if v_email.company_id is distinct from v_company_id then
    raise exception 'Source email % is assigned to company %, not %', v_email_id, v_email.company_id, v_company_id using errcode = '22023';
  end if;
  if not exists (select 1 from companies c where c.id = v_company_id and c.fund_id = p_fund_id) then
    raise exception 'Company % is not in fund %', v_company_id, p_fund_id using errcode = '22023';
  end if;

  insert into company_updates (
    fund_id, company_id, source, source_route, source_email_id,
    sender_name, sender_email, forwarded_sender_name, forwarded_sender_email,
    subject, received_at,
    body_original, body_current, body_status, body_cleaning_status, body_cleaner_version,
    extraction_status, warnings, parser_version, updated_at
  ) values (
    p_fund_id, v_company_id, 'email', 'reporting', v_email_id,
    p_update ->> 'sender_name', p_update ->> 'sender_email',
    p_update ->> 'forwarded_sender_name', p_update ->> 'forwarded_sender_email',
    p_update ->> 'subject', (p_update ->> 'received_at')::timestamptz,
    p_update ->> 'body_original', p_update ->> 'body_current',
    coalesce(p_update ->> 'body_status', 'complete'),
    coalesce(p_update ->> 'body_cleaning_status', 'not_applicable'),
    p_update ->> 'body_cleaner_version',
    coalesce(p_update ->> 'extraction_status', 'complete'),
    coalesce(p_update -> 'warnings', '[]'::jsonb),
    p_update ->> 'parser_version',
    v_now
  )
  on conflict (source_email_id) do update set
    fund_id = excluded.fund_id,
    company_id = excluded.company_id,
    sender_name = excluded.sender_name,
    sender_email = excluded.sender_email,
    forwarded_sender_name = excluded.forwarded_sender_name,
    forwarded_sender_email = excluded.forwarded_sender_email,
    subject = excluded.subject,
    received_at = excluded.received_at,
    body_original = excluded.body_original,
    body_current = excluded.body_current,
    body_status = excluded.body_status,
    body_cleaning_status = excluded.body_cleaning_status,
    body_cleaner_version = excluded.body_cleaner_version,
    extraction_status = excluded.extraction_status,
    warnings = excluded.warnings,
    parser_version = excluded.parser_version,
    updated_at = excluded.updated_at
  returning id into v_update_id;

  -- Every chunk of this update is replaced as a unit: removed quoted text, a re-parsed sheet, a
  -- deleted attachment — none of it may remain searchable after this statement commits.
  delete from company_update_chunks where update_id = v_update_id and fund_id = p_fund_id;

  for v_artifact in select * from jsonb_array_elements(coalesce(p_artifacts, '[]'::jsonb)) loop
    v_keys := v_keys || (v_artifact ->> 'attachment_key');
  end loop;

  delete from company_update_artifacts
   where update_id = v_update_id and fund_id = p_fund_id
     and not (attachment_key = any(v_keys));

  for v_artifact in select * from jsonb_array_elements(coalesce(p_artifacts, '[]'::jsonb)) loop
    insert into company_update_artifacts (
      fund_id, company_id, update_id, attachment_key, ordinal, filename,
      declared_content_type, detected_content_type, storage_path, byte_size, content_sha256,
      extracted_text, extraction_status, parser, parser_version, warnings, extraction_error, metadata,
      ocr_status, ocr_error, ocr_updated_at, updated_at
    ) values (
      p_fund_id, v_company_id, v_update_id,
      v_artifact ->> 'attachment_key', (v_artifact ->> 'ordinal')::int, v_artifact ->> 'filename',
      v_artifact ->> 'declared_content_type', v_artifact ->> 'detected_content_type',
      v_artifact ->> 'storage_path', (v_artifact ->> 'byte_size')::bigint, v_artifact ->> 'content_sha256',
      v_artifact ->> 'extracted_text', coalesce(v_artifact ->> 'extraction_status', 'failed'),
      v_artifact ->> 'parser', v_artifact ->> 'parser_version',
      coalesce(v_artifact -> 'warnings', '[]'::jsonb), v_artifact ->> 'extraction_error',
      coalesce(v_artifact -> 'metadata', '{}'::jsonb),
      coalesce(v_artifact ->> 'ocr_status', 'not_needed'), null,
      case when coalesce(v_artifact ->> 'ocr_status', 'not_needed') = 'pending' then v_now else null end,
      v_now
    )
    on conflict (update_id, attachment_key) do update set
      company_id = excluded.company_id,
      ordinal = excluded.ordinal,
      filename = excluded.filename,
      declared_content_type = excluded.declared_content_type,
      detected_content_type = excluded.detected_content_type,
      storage_path = excluded.storage_path,
      byte_size = excluded.byte_size,
      content_sha256 = excluded.content_sha256,
      extracted_text = excluded.extracted_text,
      extraction_status = excluded.extraction_status,
      parser = excluded.parser,
      parser_version = excluded.parser_version,
      warnings = excluded.warnings,
      extraction_error = excluded.extraction_error,
      metadata = excluded.metadata,
      -- A fresh parse resets OCR state: either the new parse needs it again or it no longer does.
      ocr_status = excluded.ocr_status,
      ocr_attempts = 0,
      ocr_error = null,
      ocr_updated_at = excluded.ocr_updated_at,
      updated_at = excluded.updated_at
    returning id into v_artifact_id;

    v_map := v_map || jsonb_build_object(v_artifact ->> 'attachment_key', v_artifact_id);

    for v_chunk in select * from jsonb_array_elements(coalesce(v_artifact -> 'chunks', '[]'::jsonb)) loop
      insert into company_update_chunks (
        fund_id, company_id, update_id, artifact_id, chunk_kind, ordinal, locator, content, parser_version
      ) values (
        p_fund_id, v_company_id, v_update_id, v_artifact_id,
        coalesce(v_chunk ->> 'chunk_kind', 'attachment'), (v_chunk ->> 'ordinal')::int,
        coalesce(v_chunk -> 'locator', '{}'::jsonb), v_chunk ->> 'content',
        coalesce(v_chunk ->> 'parser_version', v_artifact ->> 'parser_version', 'unknown')
      );
    end loop;
  end loop;

  for v_chunk in select * from jsonb_array_elements(coalesce(p_body_chunks, '[]'::jsonb)) loop
    insert into company_update_chunks (
      fund_id, company_id, update_id, artifact_id, chunk_kind, ordinal, locator, content, parser_version
    ) values (
      p_fund_id, v_company_id, v_update_id, null,
      v_chunk ->> 'chunk_kind', (v_chunk ->> 'ordinal')::int,
      coalesce(v_chunk -> 'locator', '{}'::jsonb), v_chunk ->> 'content',
      coalesce(v_chunk ->> 'parser_version', p_update ->> 'parser_version', 'unknown')
    );
  end loop;

  return jsonb_build_object('update_id', v_update_id, 'artifacts', v_map);
end;
$$;

revoke execute on function public.company_update_replace(uuid, jsonb, jsonb, jsonb) from anon, authenticated, public;
grant execute on function public.company_update_replace(uuid, jsonb, jsonb, jsonb) to service_role;

-- ─── 4. The projection follows its source email ───────────────────────────────────────────────

create or replace function public.company_updates_follow_inbound_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Leaving portfolio reporting, or losing its company, removes the update (artifacts and chunks
  -- cascade). The pipeline recreates it if the email later comes back.
  if coalesce(new.routed_to, 'reporting') <> 'reporting' or new.company_id is null then
    delete from company_updates where source_email_id = new.id and fund_id = new.fund_id;
    return new;
  end if;

  if new.company_id is distinct from old.company_id then
    if not exists (select 1 from companies c where c.id = new.company_id and c.fund_id = new.fund_id) then
      raise exception 'Company % is not in fund %', new.company_id, new.fund_id using errcode = '22023';
    end if;
    update company_updates
       set company_id = new.company_id, updated_at = now()
     where source_email_id = new.id and fund_id = new.fund_id;
    update company_update_artifacts a
       set company_id = new.company_id, updated_at = now()
      from company_updates u
     where u.id = a.update_id and u.source_email_id = new.id and u.fund_id = new.fund_id and a.fund_id = new.fund_id;
    update company_update_chunks c
       set company_id = new.company_id
      from company_updates u
     where u.id = c.update_id and u.source_email_id = new.id and u.fund_id = new.fund_id and c.fund_id = new.fund_id;
  end if;
  return new;
end;
$$;

create trigger company_updates_follow_inbound_email
  after update of company_id, routed_to on public.inbound_emails
  for each row execute function public.company_updates_follow_inbound_email();

-- ─── 5. OCR queue ─────────────────────────────────────────────────────────────────────────────

create or replace function public.company_update_ocr_claim(p_limit int default 5, p_fund_id uuid default null)
returns setof public.company_update_artifacts
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'p_limit must be between 1 and 50' using errcode = '22023';
  end if;
  return query
    update company_update_artifacts a
       set ocr_status = 'running', ocr_attempts = a.ocr_attempts + 1, ocr_updated_at = now(), updated_at = now()
     where a.id in (
       select x.id from company_update_artifacts x
        where x.ocr_status = 'pending'
          and (p_fund_id is null or x.fund_id = p_fund_id)
          and x.ocr_attempts < 3
        order by x.created_at
        limit p_limit
        for update skip locked
     )
    returning a.*;
end;
$$;

revoke execute on function public.company_update_ocr_claim(int, uuid) from anon, authenticated, public;
grant execute on function public.company_update_ocr_claim(int, uuid) to service_role;

-- Merge an OCR result into its artifact. p_patch carries extracted_text, extraction_status,
-- warnings, metadata, parser, parser_version, ocr_status ('complete' | 'failed'), ocr_error.
-- p_chunks is the artifact's COMPLETE chunk set after OCR (selectable-text pages plus OCR pages).
create or replace function public.company_update_artifact_apply_ocr(
  p_fund_id uuid,
  p_artifact_id uuid,
  p_patch jsonb,
  p_chunks jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artifact record;
  v_chunk jsonb;
  v_status text;
  v_warnings jsonb;
begin
  select * into v_artifact from company_update_artifacts
   where id = p_artifact_id and fund_id = p_fund_id for update;
  if not found then
    raise exception 'Artifact % is not in fund %', p_artifact_id, p_fund_id using errcode = 'P0002';
  end if;

  update company_update_artifacts set
    extracted_text = coalesce(p_patch ->> 'extracted_text', extracted_text),
    extraction_status = coalesce(p_patch ->> 'extraction_status', extraction_status),
    warnings = coalesce(p_patch -> 'warnings', warnings),
    metadata = coalesce(p_patch -> 'metadata', metadata),
    parser = coalesce(p_patch ->> 'parser', parser),
    parser_version = coalesce(p_patch ->> 'parser_version', parser_version),
    extraction_error = case when p_patch ? 'extraction_error' then p_patch ->> 'extraction_error' else extraction_error end,
    ocr_status = coalesce(p_patch ->> 'ocr_status', ocr_status),
    ocr_error = p_patch ->> 'ocr_error',
    ocr_updated_at = now(),
    updated_at = now()
  where id = p_artifact_id;

  if p_chunks is not null then
    delete from company_update_chunks where artifact_id = p_artifact_id and fund_id = p_fund_id;
    for v_chunk in select * from jsonb_array_elements(p_chunks) loop
      insert into company_update_chunks (
        fund_id, company_id, update_id, artifact_id, chunk_kind, ordinal, locator, content, parser_version
      ) values (
        p_fund_id, v_artifact.company_id, v_artifact.update_id, p_artifact_id,
        coalesce(v_chunk ->> 'chunk_kind', 'attachment'), (v_chunk ->> 'ordinal')::int,
        coalesce(v_chunk -> 'locator', '{}'::jsonb), v_chunk ->> 'content',
        coalesce(v_chunk ->> 'parser_version', p_patch ->> 'parser_version', v_artifact.parser_version, 'unknown')
      );
    end loop;
  end if;

  -- Re-derive the update's overall completeness from its body and every artifact, the same rule
  -- capture uses: all complete → complete; any usable content → partial; otherwise failed.
  select
    case
      when bool_and(s = 'complete') then 'complete'
      when bool_or(s in ('complete', 'partial')) then 'partial'
      else 'failed'
    end
    into v_status
    from (
      select u.body_status as s from company_updates u where u.id = v_artifact.update_id
      union all
      select a.extraction_status from company_update_artifacts a where a.update_id = v_artifact.update_id
    ) statuses;

  select coalesce(jsonb_agg(w order by ord), '[]'::jsonb) into v_warnings
    from (
      select w, 0 as ord from company_updates u, jsonb_array_elements(u.warnings) w
       where u.id = v_artifact.update_id
         and left(w #>> '{}', length(v_artifact.filename) + 2) <> (v_artifact.filename || ': ')
      union all
      select to_jsonb(v_artifact.filename || ': ' || (w #>> '{}')), 1
        from company_update_artifacts a, jsonb_array_elements(a.warnings) w
       where a.id = p_artifact_id
    ) merged;

  update company_updates
     set extraction_status = v_status, warnings = v_warnings, updated_at = now()
   where id = v_artifact.update_id and fund_id = p_fund_id;
end;
$$;

revoke execute on function public.company_update_artifact_apply_ocr(uuid, uuid, jsonb, jsonb) from anon, authenticated, public;
grant execute on function public.company_update_artifact_apply_ocr(uuid, uuid, jsonb, jsonb) to service_role;

-- ─── 6. Search ────────────────────────────────────────────────────────────────────────────────

-- One pass in one match mode. The public entry point below decides the mode and the fallback.
-- Fetches p_limit + 1 rows so "is there another page" is answered from the same scan that
-- produced the page, and the cursor is the last row actually returned.
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
       and p_mode = 'exact' and c.content ilike v_pat escape '\'
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
             or (p_mode = 'exact' and c.content ilike v_pat escape '\')
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

-- Public entry point. Validates inputs (explicit errors, never empty success), picks the match
-- mode, and falls back from lexical to exact-substring when the lexical query finds nothing or
-- cannot be tokenised — identifiers, financial strings and symbols live there.
create or replace function public.company_updates_search(
  p_fund_id uuid,
  p_query text default null,
  p_company_ids uuid[] default null,
  p_since date default null,
  p_until date default null,
  p_latest_per_company boolean default false,
  p_order text default null,
  p_match text default 'auto',
  p_limit int default 20,
  p_cursor jsonb default null,
  p_excerpts int default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_order text;
  v_mode text;
  v_result jsonb;
begin
  if p_fund_id is null then
    raise exception 'p_fund_id is required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_excerpts is null or p_excerpts < 0 or p_excerpts > 10 then
    raise exception 'p_excerpts must be between 0 and 10' using errcode = '22023';
  end if;
  if p_since is not null and p_until is not null and p_since > p_until then
    raise exception 'p_since must not be after p_until' using errcode = '22023';
  end if;
  if p_match not in ('auto', 'lexical', 'exact') then
    raise exception 'p_match must be auto, lexical or exact' using errcode = '22023';
  end if;
  if p_order is not null and p_order not in ('relevance', 'newest') then
    raise exception 'p_order must be relevance or newest' using errcode = '22023';
  end if;
  if p_cursor is not null and ((p_cursor ->> 'received_at') is null or (p_cursor ->> 'id') is null) then
    raise exception 'p_cursor is malformed' using errcode = '22023';
  end if;
  if p_cursor is not null and coalesce(p_order, 'relevance') = 'relevance'
     and nullif(btrim(coalesce(p_query, '')), '') is not null and (p_cursor ->> 'rank') is null then
    raise exception 'p_cursor is missing rank for relevance ordering' using errcode = '22023';
  end if;

  v_order := coalesce(p_order, case when v_query is null then 'newest' else 'relevance' end);
  if v_query is null then
    v_order := 'newest';
    v_mode := 'none';
  elsif p_cursor ->> 'mode' in ('lexical', 'exact') then
    -- A continuation stays in the mode that produced page one; otherwise an auto fallback could
    -- switch corpora mid-pagination and duplicate or skip results.
    v_mode := p_cursor ->> 'mode';
  elsif p_match = 'exact' then
    v_mode := 'exact';
  elsif numnode(websearch_to_tsquery('english', v_query)) = 0 then
    -- Nothing survives tokenisation (stop words, symbols, a bare number): only a substring match
    -- can honour the query.
    if p_match = 'lexical' then
      raise exception 'Query has no searchable terms for lexical matching' using errcode = '22023';
    end if;
    v_mode := 'exact';
  else
    v_mode := 'lexical';
  end if;

  v_result := company_updates_search_run(
    p_fund_id, v_query, v_mode, p_company_ids, p_since, p_until, p_latest_per_company,
    v_order, p_limit, p_cursor, p_excerpts
  );

  if p_match = 'auto' and v_mode = 'lexical' and p_cursor is null and (v_result ->> 'total')::bigint = 0 then
    v_result := company_updates_search_run(
      p_fund_id, v_query, 'exact', p_company_ids, p_since, p_until, p_latest_per_company,
      v_order, p_limit, null, p_excerpts
    );
    v_result := v_result || jsonb_build_object('fallback', 'exact');
  end if;

  return v_result;
end;
$$;

revoke execute on function public.company_updates_search(uuid, text, uuid[], date, date, boolean, text, text, int, jsonb, int) from anon, authenticated, public;
grant execute on function public.company_updates_search(uuid, text, uuid[], date, date, boolean, text, text, int, jsonb, int) to service_role;

-- ─── 7. Backfill jobs ─────────────────────────────────────────────────────────────────────────

create table public.company_update_backfill_jobs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  mode text not null check (mode in ('dry_run', 'sample', 'full')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  parser_version text not null,
  reprocess boolean not null default false,
  sample_company_id uuid references public.companies(id) on delete set null,
  sample_limit int check (sample_limit is null or sample_limit between 1 and 1000),
  concurrency int not null default 3 check (concurrency between 1 and 10),
  total_eligible int not null default 0,
  planned int not null default 0,
  counts jsonb not null default '{}'::jsonb,
  plan_cursor jsonb,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Infrastructure, not fund content: only the service role (API routes, cron worker, operator
-- script) touches these. Status reaches the UI through fund-scoped API routes, not the Data API.
revoke all on public.company_update_backfill_jobs from anon, authenticated;
grant select, insert, update, delete on public.company_update_backfill_jobs to service_role;

create index company_update_backfill_jobs_fund_idx
  on public.company_update_backfill_jobs (fund_id, created_at desc);
create index company_update_backfill_jobs_active_idx
  on public.company_update_backfill_jobs (created_at)
  where status in ('pending', 'running');

alter table public.company_update_backfill_jobs enable row level security;

create table public.company_update_backfill_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.company_update_backfill_jobs(id) on delete cascade,
  fund_id uuid not null references public.funds(id) on delete cascade,
  email_id uuid not null references public.inbound_emails(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts int not null default 0,
  error text,
  result jsonb,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, email_id)
);

revoke all on public.company_update_backfill_items from anon, authenticated;
grant select, insert, update, delete on public.company_update_backfill_items to service_role;

create index company_update_backfill_items_job_status_idx
  on public.company_update_backfill_items (job_id, status, created_at);

alter table public.company_update_backfill_items enable row level security;

-- Claim a batch of pending items for one job. Overlapping workers (a cron tick racing an operator
-- script) each get disjoint rows.
create or replace function public.company_update_backfill_claim(p_job_id uuid, p_limit int default 10)
returns setof public.company_update_backfill_items
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100' using errcode = '22023';
  end if;
  return query
    update company_update_backfill_items i
       set status = 'running', attempts = i.attempts + 1, claimed_at = now()
     where i.id in (
       select x.id from company_update_backfill_items x
        where x.job_id = p_job_id and x.status = 'pending'
        order by x.created_at
        limit p_limit
        for update skip locked
     )
    returning i.*;
end;
$$;

revoke execute on function public.company_update_backfill_claim(uuid, int) from anon, authenticated, public;
grant execute on function public.company_update_backfill_claim(uuid, int) to service_role;

-- ─── 8. Observability ─────────────────────────────────────────────────────────────────────────

-- Coverage and quality counts the spec asks for, computed in one call. Eligibility here is the
-- capture rule: effective route is reporting (null = legacy pre-routing email) and a company is
-- assigned.
create or replace function public.company_updates_stats(p_fund_id uuid, p_current_parser_version text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select ie.id, ie.raw_payload
      from inbound_emails ie
     where ie.fund_id = p_fund_id
       and ie.company_id is not null
       and coalesce(ie.routed_to, 'reporting') = 'reporting'
  ),
  source_attachments as (
    select coalesce(sum(jsonb_array_length(coalesce(e.raw_payload -> 'Attachments', '[]'::jsonb))), 0) as n
      from eligible e
     where jsonb_typeof(e.raw_payload -> 'Attachments') = 'array'
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
    'source_attachments', (select n from source_attachments),
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
