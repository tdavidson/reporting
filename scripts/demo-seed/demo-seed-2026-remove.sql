-- Removes exactly what demo-seed-2026.sql added: the tagged bank rows, then the tagged entries (postings cascade).
begin;
delete from bank_transactions where fund_id = 'e2dfd2bf-ced3-4647-8277-096e616a6eab' and raw->>'demo_seed' = '2026';
delete from journal_postings where journal_entry_id in (select id from journal_entries where fund_id = 'e2dfd2bf-ced3-4647-8277-096e616a6eab' and source_ref = 'demo-seed-2026');
delete from journal_entries where fund_id = 'e2dfd2bf-ced3-4647-8277-096e616a6eab' and source_ref = 'demo-seed-2026';
commit;
