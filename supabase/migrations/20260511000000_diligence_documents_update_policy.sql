-- Defense-in-depth: the diligence-documents storage bucket has select, insert,
-- and delete policies but is missing an update policy. The render job uses the
-- service-role admin client (which bypasses RLS) so this isn't currently
-- exploitable, but adding the explicit update policy prevents a regression if
-- any future code path switches to the user-context client for upserts.

create policy "Fund members can update diligence documents"
  on storage.objects for update
  using (
    bucket_id = 'diligence-documents'
    and exists (
      select 1 from diligence_deals d
      join fund_members fm on fm.fund_id = d.fund_id
      where d.id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'diligence-documents'
    and exists (
      select 1 from diligence_deals d
      join fund_members fm on fm.fund_id = d.fund_id
      where d.id = (storage.foldername(name))[1]::uuid
        and fm.user_id = auth.uid()
    )
  );
