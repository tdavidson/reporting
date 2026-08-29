import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import type { Json } from '@/lib/types/database'

/**
 * Download an attachment from an inbound email. Linked from the deal-detail
 * page (`/deals/[id]`) as `/api/emails/${email_id}/attachment/${index}`.
 *
 * Security model:
 *   - Auth: caller must be a member of the fund that owns the email.
 *   - Index is validated against `raw_payload.Attachments[]`.
 *   - Downloads use Supabase Storage's signed-URL `download` option. Explicit
 *     inline requests are honored only for PDFs and a small raster-image
 *     allowlist; every other MIME type is still forced to download. This keeps
 *     HTML/SVG and MIME-confusion payloads out of an inline browser context.
 *   - Signed URLs are short-lived (60s) so they can't be leaked or shared.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string; index: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const fundId = (membership as any).fund_id as string

  const idx = Number.parseInt(params.index, 10)
  if (!Number.isInteger(idx) || idx < 0 || idx > 99) {
    return NextResponse.json({ error: 'Invalid attachment index' }, { status: 400 })
  }

  const { data: email } = await admin
    .from('inbound_emails')
    .select('id, fund_id, raw_payload')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const attachments = ((email as any).raw_payload?.Attachments ?? []) as Array<{
    Name?: string
    ContentType?: string
    StoragePath?: string
  }>
  const att = attachments[idx]
  if (!att?.StoragePath) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  // The StoragePath was set at email-ingest time and must live under the
  // email's folder. Re-verify to catch any drift.
  if (!att.StoragePath.startsWith(`${params.id}/`)) {
    return NextResponse.json({ error: 'Storage path mismatch' }, { status: 400 })
  }

  // Force unsafe types to download. The filename passed here ends up in the
  // header verbatim, so sanitize it to plain ASCII-safe characters.
  const downloadName = (att.Name ?? 'attachment').replace(/[^\w.\-]/g, '_').slice(0, 200)
  const wantsInline = req.nextUrl.searchParams.get('disposition') === 'inline'
  const inlineSafe = att.ContentType === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(att.ContentType ?? '')
  const { data: signed, error } = await admin.storage
    .from('email-attachments')
    .createSignedUrl(att.StoragePath, 60, wantsInline && inlineSafe ? undefined : { download: downloadName })
  if (error || !signed) {
    return NextResponse.json({ error: error?.message ?? 'Failed to sign URL' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl, 302)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; index: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const idx = Number.parseInt(params.index, 10)
  if (!Number.isInteger(idx) || idx < 0 || idx > 99) {
    return NextResponse.json({ error: 'Invalid attachment index' }, { status: 400 })
  }

  const requestedKey = req.nextUrl.searchParams.get('key')
  let targetFingerprint: string | null = null
  let attachment: Record<string, unknown> | null = null
  let updated = false

  // Optimistic compare-and-swap prevents two tabs from overwriting each
  // other's raw_payload edits. Stable StoragePath/AttachmentId keys also mean
  // an index shift can never cause the wrong attachment to be removed.
  for (let attempt = 0; attempt < 3 && !updated; attempt++) {
    const { data: email } = await admin
      .from('inbound_emails')
      .select('id, raw_payload')
      .eq('id', params.id)
      .eq('fund_id', writeCheck.fundId)
      .maybeSingle()
    if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const payload = ((email as any).raw_payload ?? {}) as Record<string, unknown>
    const attachments = Array.isArray(payload.Attachments)
      ? payload.Attachments as Array<Record<string, unknown>>
      : []
    if (attempt === 0 && !attachments[idx]) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    if (!targetFingerprint) targetFingerprint = attachmentFingerprint(attachments[idx])
    const targetIndex = attachments.findIndex(att =>
      requestedKey
        ? att.AttachmentId === requestedKey || att.StoragePath === requestedKey
        : attachmentFingerprint(att) === targetFingerprint
    )
    if (targetIndex < 0) return NextResponse.json({ error: 'Attachment no longer exists' }, { status: 409 })

    attachment = attachments[targetIndex]
    const remaining = attachments.filter((_, index) => index !== targetIndex)
    const { data: changed, error: updateError } = await admin
      .from('inbound_emails')
      .update({
        raw_payload: { ...payload, Attachments: remaining } as Json,
        attachments_count: remaining.length,
      })
      .eq('id', params.id)
      .eq('fund_id', writeCheck.fundId)
      .eq('raw_payload', payload as Record<string, Json | undefined>)
      .select('id')
      .maybeSingle()
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    updated = !!changed
  }

  if (!updated || !attachment) {
    return NextResponse.json({ error: 'Attachment changed while deleting; please try again' }, { status: 409 })
  }

  const storagePath = typeof attachment.StoragePath === 'string' ? attachment.StoragePath : null
  if (storagePath?.startsWith(`${params.id}/`)) {
    const { error: removeError } = await admin.storage.from('email-attachments').remove([storagePath])
    if (removeError) {
      console.error(`[attachment-delete] Orphaned storage object ${storagePath}:`, removeError)
    }
  }

  return NextResponse.json({ ok: true })
}

function attachmentFingerprint(attachment: Record<string, unknown> | undefined): string {
  if (!attachment) return ''
  return [attachment.Name, attachment.ContentType, attachment.ContentLength].map(String).join('\u0000')
}
