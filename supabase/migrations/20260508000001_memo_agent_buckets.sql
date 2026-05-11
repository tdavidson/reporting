-- Storage buckets for the Memo Agent (Diligence) feature.
-- Path structure: {dealId}/{filename} for diligence-documents,
--                 {fundId}/{filename} for style-anchor-memos.

insert into storage.buckets (id, name, public, file_size_limit)
values ('diligence-documents', 'diligence-documents', false, 104857600)  -- 100MB limit
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('style-anchor-memos', 'style-anchor-memos', false, 20971520)     -- 20MB limit
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- diligence-documents RLS — folder is the deal_id; access flows from
-- diligence_deals.fund_id → fund_members.user_id.
-- ---------------------------------------------------------------------------

create policy "Fund members can read diligence documents"
  on storage.objects for select
  using (
    bucket_id = 'diligence-documents'
    and exists (
      select 1 from diligence_deals d
      join fund_members fm on fm.fund_id = d.fund_id
      where d.id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
    )
  );

create policy "Fund members can upload diligence documents"
  on storage.objects for insert
  with check (
    bucket_id = 'diligence-documents'
    and exists (
      select 1 from diligence_deals d
      join fund_members fm on fm.fund_id = d.fund_id
      where d.id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
    )
  );

create policy "Fund admins can delete diligence documents"
  on storage.objects for delete
  using (
    bucket_id = 'diligence-documents'
    and exists (
      select 1 from diligence_deals d
      join fund_members fm on fm.fund_id = d.fund_id
      where d.id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
        and fm.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- style-anchor-memos RLS — folder is the fund_id; admin-only writes.
-- ---------------------------------------------------------------------------

create policy "Fund members can read style anchors"
  on storage.objects for select
  using (
    bucket_id = 'style-anchor-memos'
    and exists (
      select 1 from fund_members fm
      where fm.fund_id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
    )
  );

create policy "Fund admins can upload style anchors"
  on storage.objects for insert
  with check (
    bucket_id = 'style-anchor-memos'
    and exists (
      select 1 from fund_members fm
      where fm.fund_id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
        and fm.role = 'admin'
    )
  );

create policy "Fund admins can delete style anchors"
  on storage.objects for delete
  using (
    bucket_id = 'style-anchor-memos'
    and exists (
      select 1 from fund_members fm
      where fm.fund_id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
        and fm.role = 'admin'
    )
  );
