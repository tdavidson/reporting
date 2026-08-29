-- Remove one attachment from an inbound email without a client-side JSON
-- read/modify/write race. The row lock serializes concurrent deletes, while
-- the stable AttachmentId/StoragePath key prevents array-index drift.
create or replace function public.delete_email_attachment(
  p_email_id uuid,
  p_attachment_index integer,
  p_attachment_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  payload jsonb;
  attachments jsonb;
  attachment jsonb;
  target_index integer := -1;
  i integer;
begin
  if p_attachment_index < 0 or p_attachment_index > 99 then
    raise exception 'Invalid attachment index' using errcode = '22023';
  end if;

  select ie.raw_payload
    into payload
    from public.inbound_emails ie
   where ie.id = p_email_id
     and public.is_fund_writer(ie.fund_id)
   for update;

  if not found then
    raise exception 'Email not found' using errcode = 'P0002';
  end if;

  attachments := coalesce(payload -> 'Attachments', '[]'::jsonb);
  if jsonb_typeof(attachments) <> 'array' then
    raise exception 'Invalid attachments payload' using errcode = '22023';
  end if;

  if p_attachment_key is not null and p_attachment_key <> '' then
    if jsonb_array_length(attachments) > 0 then
      for i in 0..jsonb_array_length(attachments) - 1 loop
        attachment := attachments -> i;
        if attachment ->> 'AttachmentId' = p_attachment_key
           or attachment ->> 'StoragePath' = p_attachment_key then
          target_index := i;
          exit;
        end if;
      end loop;
    end if;
  elsif p_attachment_index < jsonb_array_length(attachments) then
    target_index := p_attachment_index;
  end if;

  if target_index < 0 then
    raise exception 'Attachment not found' using errcode = 'P0002';
  end if;

  attachment := attachments -> target_index;
  attachments := attachments - target_index;

  update public.inbound_emails
     set raw_payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{Attachments}', attachments, true),
         attachments_count = jsonb_array_length(attachments)
   where id = p_email_id;

  return jsonb_build_object(
    'storage_path', attachment ->> 'StoragePath',
    'filename', attachment ->> 'Name'
  );
end;
$$;

revoke all on function public.delete_email_attachment(uuid, integer, text) from public;
grant execute on function public.delete_email_attachment(uuid, integer, text) to authenticated;
