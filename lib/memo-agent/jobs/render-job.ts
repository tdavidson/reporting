import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveSchema, ensureDefaults } from '@/lib/memo-agent/firm-schemas'
import { renderMarkdown } from '@/lib/memo-agent/render/markdown'
import { renderDocx } from '@/lib/memo-agent/render/docx'
import { uploadDocxToDrive } from '@/lib/memo-agent/render/gdoc'

type Admin = ReturnType<typeof createAdminClient>

export type RenderFormat = 'markdown' | 'docx' | 'gdoc'

interface RenderJob {
  id: string
  fund_id: string
  deal_id: string
  draft_id: string | null
  payload: Record<string, unknown>
}

/**
 * Render a draft to one of the three target formats. The job result includes
 * either inline content (markdown) or a download/view URL (docx, gdoc). The
 * draft itself is not modified.
 */
export async function runRenderJob(admin: Admin, job: RenderJob): Promise<unknown> {
  const format = (job.payload?.format as string) ?? 'markdown'
  if (!['markdown', 'docx', 'gdoc'].includes(format)) {
    throw new Error(`Unsupported render format: ${format}`)
  }

  const draftId = job.draft_id ?? (typeof job.payload?.draft_id === 'string' ? (job.payload.draft_id as string) : null)
  if (!draftId) throw new Error('draft_id required for render job')

  const { data: draft } = await admin
    .from('diligence_memo_drafts')
    .select('id, draft_version, is_draft, memo_draft_output')
    .eq('id', draftId)
    .eq('fund_id', job.fund_id)
    .maybeSingle()
  if (!draft) throw new Error('Draft not found')
  if (!(draft as any).memo_draft_output) throw new Error('Draft has no memo_draft_output — run Stage 4 first.')

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('name')
    .eq('id', job.deal_id)
    .eq('fund_id', job.fund_id)
    .maybeSingle()
  const dealName = (deal as { name: string } | null)?.name ?? 'Untitled deal'

  // Seed-on-demand so a fund that never visited the Schemas editor still
  // gets a non-empty memo_output schema. Without this the renderer's
  // sectionMeta map is empty and every section gets skipped — the symptom
  // is a docx with only the header and no body content.
  await ensureDefaults(job.fund_id, admin)
  const memoOutputSchema = await getActiveSchema(job.fund_id, 'memo_output', admin)
  const rubricSchema = await getActiveSchema(job.fund_id, 'rubric', admin)

  const renderInput = {
    memo: (draft as any).memo_draft_output,
    memoOutputYaml: memoOutputSchema?.yaml_content ?? '',
    rubricYaml: rubricSchema?.yaml_content ?? '',
    isDraft: !!(draft as any).is_draft,
    dealName,
    draftVersion: (draft as any).draft_version,
  }

  if (format === 'markdown') {
    const md = renderMarkdown(renderInput)
    return { format, content: md, length: md.length }
  }

  // Build docx for both docx and gdoc.
  const buffer = await renderDocx(renderInput)
  const safeDealName = dealName.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 80)
  const filename = `${safeDealName} memo (${(draft as any).draft_version}).docx`

  if (format === 'docx') {
    const storagePath = `${job.deal_id}/renders/${Date.now()}_${filename}`
    const { error: uploadErr } = await admin.storage
      .from('diligence-documents')
      .upload(storagePath, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: true })
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

    // Signed URL for partner download — expires in 24h.
    const { data: signed, error: signErr } = await admin.storage
      .from('diligence-documents')
      .createSignedUrl(storagePath, 60 * 60 * 24)
    if (signErr) throw new Error(`Signed URL failed: ${signErr.message}`)
    return {
      format,
      filename,
      download_url: signed?.signedUrl ?? null,
      storage_path: storagePath,
      bytes: buffer.length,
    }
  }

  // gdoc: upload + convert to Google Doc.
  const result = await uploadDocxToDrive({
    admin,
    fundId: job.fund_id,
    filename,
    buffer,
  })
  return {
    format,
    filename,
    drive_file_id: result.fileId,
    web_view_link: result.webViewLink,
    bytes: buffer.length,
  }
}
