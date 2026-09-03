-- Fix: company_update_chunks_search_trigger passed a text weight to setweight(), which only accepts
-- "char". Every chunk insert — and therefore every capture — failed with
-- "function setweight(tsvector, text) does not exist". Surfaced by the first sample backfill.
-- Same function, same weights, explicit cast.

create or replace function public.company_update_chunks_search_trigger()
returns trigger
language plpgsql
as $$
begin
  new.search := setweight(
    to_tsvector('english', coalesce(new.content, '')),
    (case new.chunk_kind
      when 'subject' then 'A'
      when 'artifact_title' then 'A'
      when 'body_current' then 'B'
      when 'attachment' then 'C'
      else 'D'
    end)::"char"
  );
  return new;
end;
$$;
