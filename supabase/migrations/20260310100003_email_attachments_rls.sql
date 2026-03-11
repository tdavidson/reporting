-- RLS policies for email-attachments storage bucket
-- Path structure: {emailId}/{filename}
-- Only fund members whose fund owns the email can access the attachments

CREATE POLICY "Fund members can read email attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'email-attachments'
    AND EXISTS (
      SELECT 1 FROM inbound_emails ie
      JOIN fund_members fm ON fm.fund_id = ie.fund_id
      WHERE ie.id = (storage.foldername(name))[1]::uuid
        AND fm.user_id = auth.uid()
    )
  );

CREATE POLICY "Fund admins can upload email attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'email-attachments'
    AND EXISTS (
      SELECT 1 FROM inbound_emails ie
      JOIN fund_members fm ON fm.fund_id = ie.fund_id
      WHERE ie.id = (storage.foldername(name))[1]::uuid
        AND fm.user_id = auth.uid()
        AND fm.role = 'admin'
    )
  );

CREATE POLICY "Fund admins can delete email attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'email-attachments'
    AND EXISTS (
      SELECT 1 FROM inbound_emails ie
      JOIN fund_members fm ON fm.fund_id = ie.fund_id
      WHERE ie.id = (storage.foldername(name))[1]::uuid
        AND fm.user_id = auth.uid()
        AND fm.role = 'admin'
    )
  );
