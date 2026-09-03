-- Company Updates search verification — run against a LOCAL stack after `supabase db reset`:
--
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -v ON_ERROR_STOP=1 -f supabase/tests/company_updates_search.sql
--
-- Everything runs inside one transaction that is rolled back, so it leaves no rows behind. Each
-- block raises on failure; a clean run prints "company_updates_search: OK" at the end.
--
-- What it pins (the acceptance criteria in docs/superpowers/specs/2026-09-02-company-updates-design.md):
--   * exact phrase → the correct source passage with its locator
--   * exact counts beyond the page limit, and stable keyset pagination with no duplicates/skips
--   * inclusive `until` date semantics
--   * lexical → exact-substring fallback for an identifier the tokeniser cannot represent
--   * latest_per_company cannot return an older matching update in place of the current one
--   * the projection follows the source email (reassign moves it, reroute removes it)
--   * atomic replacement leaves no stale artifacts or chunks
--   * fund scoping: a second fund's rows are invisible

begin;

do $$
declare
  fund_a uuid := gen_random_uuid();
  fund_b uuid := gen_random_uuid();
  acme uuid := gen_random_uuid();
  globex uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid();
  e2 uuid := gen_random_uuid();
  e3 uuid := gen_random_uuid();
  eb uuid := gen_random_uuid();
  r jsonb;
  r2 jsonb;
  u1 uuid;
  first_page_ids text[];
  second_page_ids text[];
begin
  insert into funds (id, name) values (fund_a, 'Fund A'), (fund_b, 'Fund B');
  insert into companies (id, fund_id, name) values (acme, fund_a, 'Acme'), (globex, fund_a, 'Globex'), (other, fund_b, 'Other');
  insert into inbound_emails (id, fund_id, company_id, from_address, subject, received_at, routed_to, raw_payload)
  values
    (e1, fund_a, acme,   'ada@acme.test',   'July update',   '2026-08-04T09:12:00Z', 'reporting', '{"From":"ada@acme.test","To":"f@fund","TextBody":"x"}'),
    (e2, fund_a, acme,   'ada@acme.test',   'August update', '2026-09-02T09:12:00Z', 'reporting', '{"From":"ada@acme.test","To":"f@fund","TextBody":"x"}'),
    (e3, fund_a, globex, 'g@globex.test',   'Q2 update',     '2026-07-15T09:12:00Z', null,        '{"From":"g@globex.test","To":"f@fund","TextBody":"x"}'),
    (eb, fund_b, other,  'o@other.test',    'Other fund',    '2026-08-04T09:12:00Z', 'reporting', '{"From":"o@other.test","To":"f@fund","TextBody":"x"}');

  -- ── atomic replacement ────────────────────────────────────────────────────────────────────
  r := company_update_replace(fund_a,
    jsonb_build_object('source_email_id', e1, 'company_id', acme, 'subject', 'July update', 'received_at', '2026-08-04T09:12:00Z',
      'body_original', 'Customer retention rose to 96 percent. Runway 18 months. Old ref ACME-7781.',
      'body_current',  'Customer retention rose to 96 percent. Runway 18 months. Old ref ACME-7781.',
      'extraction_status', 'complete', 'parser_version', 'test'),
    jsonb_build_array(
      jsonb_build_object('attachment_key', 'storage:' || e1 || '/0_deck.pdf', 'ordinal', 0, 'filename', 'deck.pdf', 'extraction_status', 'complete', 'parser', 'unpdf', 'parser_version', 'test',
        'chunks', jsonb_build_array(jsonb_build_object('chunk_kind', 'attachment', 'ordinal', 0, 'locator', '{"page": 4}', 'content', 'Net revenue retention 118 percent on page four.'))),
      jsonb_build_object('attachment_key', 'storage:' || e1 || '/1_model.xlsx', 'ordinal', 1, 'filename', 'model.xlsx', 'extraction_status', 'complete', 'parser', 'sheetjs-xlsx', 'parser_version', 'test',
        'chunks', jsonb_build_array(jsonb_build_object('chunk_kind', 'attachment', 'ordinal', 0, 'locator', '{"sheet": "Model", "rowStart": 1, "rowEnd": 3}', 'content', 'Row 1: A=Month | B=ARR')))
    ),
    jsonb_build_array(
      jsonb_build_object('chunk_kind', 'subject', 'ordinal', 0, 'locator', '{}', 'content', 'July update'),
      jsonb_build_object('chunk_kind', 'body_current', 'ordinal', 0, 'locator', '{"section":"email_body"}', 'content', 'Customer retention rose to 96 percent. Runway 18 months. Old ref ACME-7781.')
    ));
  u1 := (r ->> 'update_id')::uuid;
  assert (select count(*) from company_update_artifacts where update_id = u1) = 2, 'two artifacts';
  assert (select count(*) from company_update_chunks where update_id = u1) = 4, 'four chunks';

  -- Replace with ONE artifact whose ordinal moved: the other artifact and its chunks must vanish.
  r := company_update_replace(fund_a,
    jsonb_build_object('source_email_id', e1, 'company_id', acme, 'subject', 'July update', 'received_at', '2026-08-04T09:12:00Z',
      'body_original', 'Customer retention rose to 96 percent. Runway 18 months. Old ref ACME-7781.',
      'body_current',  'Customer retention rose to 96 percent. Runway 18 months. Old ref ACME-7781.',
      'extraction_status', 'complete', 'parser_version', 'test'),
    jsonb_build_array(
      jsonb_build_object('attachment_key', 'storage:' || e1 || '/1_model.xlsx', 'ordinal', 0, 'filename', 'model.xlsx', 'extraction_status', 'complete', 'parser', 'sheetjs-xlsx', 'parser_version', 'test',
        'chunks', jsonb_build_array(jsonb_build_object('chunk_kind', 'attachment', 'ordinal', 0, 'locator', '{"sheet": "Model"}', 'content', 'Row 1: A=Month | B=ARR')))),
    jsonb_build_array(
      jsonb_build_object('chunk_kind', 'subject', 'ordinal', 0, 'locator', '{}', 'content', 'July update'),
      jsonb_build_object('chunk_kind', 'body_current', 'ordinal', 0, 'locator', '{}', 'content', 'Customer retention rose to 96 percent. Runway 18 months. Old ref ACME-7781.')
    ));
  assert (r ->> 'update_id')::uuid = u1, 'idempotent by source email';
  assert (select count(*) from company_updates where source_email_id = e1) = 1, 'no duplicate update';
  assert (select count(*) from company_update_artifacts where update_id = u1) = 1, 'stale artifact removed';
  assert (select count(*) from company_update_chunks where update_id = u1) = 3, 'stale chunks removed';
  assert not exists (select 1 from company_update_chunks where update_id = u1 and content like '%page four%'), 'removed artifact text is not searchable';

  -- Wrong company / wrong fund are refused, not silently written.
  begin
    perform company_update_replace(fund_a, jsonb_build_object('source_email_id', e1, 'company_id', globex, 'received_at', '2026-08-04T09:12:00Z'), '[]', '[]');
    raise exception 'expected company mismatch to be refused';
  exception when invalid_parameter_value then null; end;
  begin
    perform company_update_replace(fund_b, jsonb_build_object('source_email_id', e1, 'company_id', acme, 'received_at', '2026-08-04T09:12:00Z'), '[]', '[]');
    raise exception 'expected cross-fund write to be refused';
  exception when no_data_found then null; end;

  -- More updates for search, pagination and latest-per-company.
  perform company_update_replace(fund_a,
    jsonb_build_object('source_email_id', e2, 'company_id', acme, 'subject', 'August update', 'received_at', '2026-09-02T09:12:00Z',
      'body_original', 'Retention dipped to 91 percent in August; runway 15 months.', 'body_current', 'Retention dipped to 91 percent in August; runway 15 months.',
      'extraction_status', 'partial', 'warnings', '["deck.pdf: PDF pages requiring OCR: 2."]', 'parser_version', 'test'),
    '[]',
    jsonb_build_array(
      jsonb_build_object('chunk_kind', 'subject', 'ordinal', 0, 'locator', '{}', 'content', 'August update'),
      jsonb_build_object('chunk_kind', 'body_current', 'ordinal', 0, 'locator', '{}', 'content', 'Retention dipped to 91 percent in August; runway 15 months.')));
  perform company_update_replace(fund_a,
    jsonb_build_object('source_email_id', e3, 'company_id', globex, 'subject', 'Q2 update', 'received_at', '2026-07-15T09:12:00Z',
      'body_original', 'Globex: retention steady at 94 percent.', 'body_current', 'Globex: retention steady at 94 percent.',
      'extraction_status', 'complete', 'parser_version', 'test'),
    '[]',
    jsonb_build_array(jsonb_build_object('chunk_kind', 'body_current', 'ordinal', 0, 'locator', '{}', 'content', 'Globex: retention steady at 94 percent.')));
  perform company_update_replace(fund_b,
    jsonb_build_object('source_email_id', eb, 'company_id', other, 'subject', 'Other fund', 'received_at', '2026-08-04T09:12:00Z',
      'body_original', 'Other fund retention 99 percent.', 'body_current', 'Other fund retention 99 percent.', 'extraction_status', 'complete', 'parser_version', 'test'),
    '[]',
    jsonb_build_array(jsonb_build_object('chunk_kind', 'body_current', 'ordinal', 0, 'locator', '{}', 'content', 'Other fund retention 99 percent.')));

  -- ── exact phrase → the correct passage and locator ────────────────────────────────────────
  r := company_updates_search(fund_a, '"retention rose"');
  assert (r ->> 'total')::int = 1, 'exact phrase matches one update, got ' || (r ->> 'total');
  assert (r -> 'results' -> 0 ->> 'update_id')::uuid = u1, 'phrase resolves to the July update';
  assert r -> 'results' -> 0 -> 'excerpts' -> 0 ->> 'text' like '%[[retention]] [[rose]]%', 'excerpt highlights the phrase';
  assert r ->> 'match_mode' = 'lexical', 'lexical mode';

  -- ── fund scoping ──────────────────────────────────────────────────────────────────────────
  r := company_updates_search(fund_a, 'retention');
  assert (r ->> 'total')::int = 3, 'fund A sees three retention updates';
  assert not exists (select 1 from jsonb_array_elements(r -> 'results') x where x ->> 'company_name' = 'Other'), 'fund B rows invisible';
  r := company_updates_search(fund_b, 'retention');
  assert (r ->> 'total')::int = 1, 'fund B sees only its own';

  -- ── exact counts beyond the page limit + stable pagination ───────────────────────────────
  r := company_updates_search(fund_a, 'retention', null, null, null, false, 'newest', 'auto', 2);
  assert (r ->> 'total')::int = 3, 'total is exact, not the page size';
  assert jsonb_array_length(r -> 'results') = 2, 'page one has two';
  assert r -> 'next_cursor' is not null, 'cursor for page two';
  select array_agg(x ->> 'update_id') into first_page_ids from jsonb_array_elements(r -> 'results') x;
  r2 := company_updates_search(fund_a, 'retention', null, null, null, false, 'newest', 'auto', 2, r -> 'next_cursor');
  assert jsonb_array_length(r2 -> 'results') = 1, 'page two has the last one';
  assert r2 -> 'next_cursor' is null, 'no cursor after the last page';
  select array_agg(x ->> 'update_id') into second_page_ids from jsonb_array_elements(r2 -> 'results') x;
  assert not (second_page_ids && first_page_ids), 'no duplicates across pages';
  assert (r2 ->> 'match_mode') = 'lexical', 'continuation keeps the mode';

  -- Relevance ordering paginates on (rank, received_at, id) without repeats either.
  r := company_updates_search(fund_a, 'retention', null, null, null, false, 'relevance', 'auto', 1);
  r2 := company_updates_search(fund_a, 'retention', null, null, null, false, 'relevance', 'auto', 1, r -> 'next_cursor');
  assert (r -> 'results' -> 0 ->> 'update_id') <> (r2 -> 'results' -> 0 ->> 'update_id'), 'relevance pages differ';

  -- ── inclusive until ───────────────────────────────────────────────────────────────────────
  r := company_updates_search(fund_a, null, null, null, '2026-08-04');
  assert (r ->> 'total')::int = 2, 'until 2026-08-04 includes the update received that day (got ' || (r ->> 'total') || ')';
  r := company_updates_search(fund_a, null, null, null, '2026-08-03');
  assert (r ->> 'total')::int = 1, 'until the day before excludes it';
  r := company_updates_search(fund_a, null, null, '2026-08-04', null);
  assert (r ->> 'total')::int = 2, 'since is inclusive too';

  -- ── identifier fallback ──────────────────────────────────────────────────────────────────
  r := company_updates_search(fund_a, 'ACME-7781');
  assert (r ->> 'total')::int = 1, 'identifier found (' || (r ->> 'total') || ')';
  r := company_updates_search(fund_a, '7781', null, null, null, false, null, 'exact');
  assert (r ->> 'total')::int = 1 and (r ->> 'match_mode') = 'exact', 'explicit exact substring';
  begin
    perform company_updates_search(fund_a, 'the', null, null, null, false, null, 'lexical');
    raise exception 'expected stop-word-only lexical query to error';
  exception when invalid_parameter_value then null; end;

  -- ── latest_per_company ───────────────────────────────────────────────────────────────────
  -- "retention rose" appears only in Acme's OLDER update. Current-state retrieval must NOT return it.
  r := company_updates_search(fund_a, '"retention rose"', null, null, null, true);
  assert (r ->> 'total')::int = 0, 'latest_per_company excludes the older matching update';
  r := company_updates_search(fund_a, 'retention', null, null, null, true);
  assert (r ->> 'total')::int = 2, 'one latest update per company';
  assert exists (select 1 from jsonb_array_elements(r -> 'results') x where x ->> 'subject' = 'August update'), 'Acme contributes its latest';

  -- ── validation errors are explicit ───────────────────────────────────────────────────────
  begin
    perform company_updates_search(fund_a, 'x', null, null, null, false, null, 'auto', 500);
    raise exception 'expected limit error';
  exception when invalid_parameter_value then null; end;
  begin
    perform company_updates_search(fund_a, 'x', null, '2026-09-01', '2026-08-01');
    raise exception 'expected date-order error';
  exception when invalid_parameter_value then null; end;

  -- ── the projection follows the source ────────────────────────────────────────────────────
  update inbound_emails set company_id = globex where id = e1;
  assert (select company_id from company_updates where source_email_id = e1) = globex, 'reassignment moved the update';
  assert (select count(*) from company_update_chunks where update_id = u1 and company_id <> globex) = 0, 'chunks moved too';
  update inbound_emails set routed_to = 'deals' where id = e1;
  assert not exists (select 1 from company_updates where source_email_id = e1), 'reroute removed the update';
  assert not exists (select 1 from company_update_chunks where update_id = u1), 'and its chunks';
  update inbound_emails set routed_to = 'reporting' where id = e1;
  assert not exists (select 1 from company_updates where source_email_id = e1), 'coming back does not resurrect it without a capture';
  delete from inbound_emails where id = e2;
  assert not exists (select 1 from company_updates where source_email_id = e2), 'deleting the source deletes the projection';

  -- ── stats ────────────────────────────────────────────────────────────────────────────────
  r := company_updates_stats(fund_a, 'test');
  assert (r ->> 'eligible_emails')::int = 2, 'eligible counts reporting + null-routed with a company';
  assert (r ->> 'captured_updates')::int = 1, 'one capture remains';

  raise notice 'company_updates_search: OK';
end $$;

rollback;
