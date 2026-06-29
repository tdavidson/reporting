-- Cache extracted text for LP documents so the LP-portal AI analyst can read
-- them. Populated best-effort on upload (see app/api/lps/documents/route.ts).
-- Existing rows stay null until re-uploaded; the analyst simply skips docs with
-- no extracted text.
alter table public.lp_documents add column if not exists extracted_text text;
