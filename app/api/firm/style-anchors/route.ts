import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractText } from '@/lib/memo-agent/extract-text'
import type { StyleAnchor } from '@/lib/memo-agent/style-anchors'

const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED_FORMATS = ['pdf', 'docx', 'md', 'markdown', 'txt'] as const

const VOICE_LEVELS = ['exemplary', 'representative', 'atypical', 'do_not_match_voice'] as const
const OUTCOMES = ['invested', 'passed', 'lost_competitive', 'withdrew', 'unknown'] as const
const CONVICTIONS = ['high', 'medium', 'low', 'mixed'] as const
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const

export async function GET() {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data, error } = await admin
    .from('style_anchor_memos')
    .select('id, fund_id, storage_path, file_name, file_format, file_size_bytes, title, anonymized, vintage_year, vintage_quarter, sector, deal_stage_at_writing, outcome, conviction_at_writing, voice_representativeness, authorship, author_initials, focus_attention_on, deprioritize_in_this_memo, partner_notes, extracted_text, extracted_at, uploaded_at')
    .eq('fund_id', fundId)
    .order('vintage_year', { ascending: false })
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Don't ship the full extracted_text on the list endpoint — it's huge.
  const anchors = ((data ?? []) as StyleAnchor[]).map(a => ({
    ...a,
    extracted_text: a.extracted_text ? `${a.extracted_text.slice(0, 200)}…` : null,
    extracted_text_length: a.extracted_text?.length ?? 0,
  }))

  return NextResponse.json(anchors)
}

export async function POST(req: NextRequest) {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId, userId } = guard

  // Two acceptance modes:
  //   1. multipart/form-data with `file` — legacy small-upload path (≤4.5 MB
  //      due to Vercel's serverless body limit). Kept for backwards compat.
  //   2. JSON with `storage_path` — the file was already uploaded directly to
  //      Supabase Storage via a signed URL. No file body transits Vercel, so
  //      this path works for the full 20 MB bucket limit. The signed URL is
  //      issued by /api/firm/style-anchors/upload-url.
  const contentType = req.headers.get('content-type') ?? ''

  let safeName: string
  let ext: string
  let storagePath: string
  let fileSize: number
  let buffer: Buffer
  let formMeta: FormData | null = null

  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    if (typeof body.storage_path !== 'string') {
      return NextResponse.json({ error: 'storage_path is required' }, { status: 400 })
    }
    storagePath = body.storage_path
    // The path must live under the caller's fund folder. Server issued the
    // signed URL with this constraint, but we re-check here defensively.
    if (!storagePath.startsWith(`${fundId}/`)) {
      return NextResponse.json({ error: 'storage_path outside fund folder' }, { status: 400 })
    }
    safeName = (typeof body.file_name === 'string' ? body.file_name : storagePath.split('/').pop() ?? '')
      .replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
    ext = (safeName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
    if (!ALLOWED_FORMATS.includes(ext as any)) {
      return NextResponse.json({ error: `Unsupported format ".${ext}". Allowed: PDF, DOCX, MD.` }, { status: 400 })
    }

    // Fetch the uploaded file from storage so we can run text extraction.
    const { data: downloaded, error: dlErr } = await admin.storage
      .from('style-anchor-memos')
      .download(storagePath)
    if (dlErr || !downloaded) {
      return NextResponse.json({ error: `Failed to read uploaded file: ${dlErr?.message ?? 'unknown'}` }, { status: 500 })
    }
    buffer = Buffer.from(await downloaded.arrayBuffer())
    fileSize = buffer.length
    if (fileSize === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    if (fileSize > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 20 MB limit' }, { status: 400 })

    // Metadata travels as siblings of storage_path in JSON.
    formMeta = new FormData()
    for (const key of ['title', 'vintage_year', 'vintage_quarter', 'sector', 'deal_stage_at_writing', 'outcome', 'conviction_at_writing', 'voice_representativeness', 'authorship', 'author_initials', 'partner_notes']) {
      if (typeof body[key] === 'string' && body[key]) formMeta.append(key, body[key])
    }
    if (Array.isArray(body.focus_attention_on)) formMeta.append('focus_attention_on', body.focus_attention_on.join(','))
    if (Array.isArray(body.deprioritize_in_this_memo)) formMeta.append('deprioritize_in_this_memo', body.deprioritize_in_this_memo.join(','))
    if (typeof body.anonymized === 'boolean') formMeta.append('anonymized', String(body.anonymized))
  } else {
    // Legacy multipart path for files under Vercel's body limit.
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Expected multipart/form-data or application/json' }, { status: 400 })
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }
    if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File exceeds 20 MB limit' }, { status: 400 })
    }

    safeName = file.name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
    ext = (safeName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
    if (!ALLOWED_FORMATS.includes(ext as any)) {
      return NextResponse.json({
        error: `Unsupported format ".${ext}". Allowed: PDF, DOCX, MD.`,
      }, { status: 400 })
    }

    buffer = Buffer.from(await file.arrayBuffer())
    fileSize = file.size
    storagePath = `${fundId}/${Date.now()}_${safeName}`

    const { error: uploadErr } = await admin.storage
      .from('style-anchor-memos')
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (uploadErr) {
      return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
    }
    formMeta = formData
  }

  // Run text extraction inline. ≤20 MB fits comfortably in a Vercel function.
  const text = await extractText(buffer, ext)

  // Pull metadata fields off the form (all optional).
  const meta = readMeta(formMeta!)

  const insert: Record<string, unknown> = {
    fund_id: fundId,
    storage_path: storagePath,
    file_name: safeName,
    file_format: ext === 'markdown' ? 'md' : (ext === 'txt' ? 'md' : ext),
    file_size_bytes: fileSize,
    extracted_text: text,
    extracted_at: text ? new Date().toISOString() : null,
    uploaded_by: userId,
    voice_representativeness: meta.voice_representativeness ?? 'representative',
    anonymized: meta.anonymized ?? false,
  }
  if (meta.title) insert.title = meta.title
  if (meta.vintage_year !== undefined) insert.vintage_year = meta.vintage_year
  if (meta.vintage_quarter) insert.vintage_quarter = meta.vintage_quarter
  if (meta.sector) insert.sector = meta.sector
  if (meta.deal_stage_at_writing) insert.deal_stage_at_writing = meta.deal_stage_at_writing
  if (meta.outcome) insert.outcome = meta.outcome
  if (meta.conviction_at_writing) insert.conviction_at_writing = meta.conviction_at_writing
  if (meta.authorship) insert.authorship = meta.authorship
  if (meta.author_initials) insert.author_initials = meta.author_initials
  if (meta.focus_attention_on) insert.focus_attention_on = meta.focus_attention_on as any
  if (meta.deprioritize_in_this_memo) insert.deprioritize_in_this_memo = meta.deprioritize_in_this_memo as any
  if (meta.partner_notes) insert.partner_notes = meta.partner_notes

  const { data: row, error: insertErr } = await admin
    .from('style_anchor_memos')
    .insert(insert as any)
    .select('id, file_name, file_format, file_size_bytes, voice_representativeness, vintage_year, sector, extracted_at, uploaded_at')
    .single()

  if (insertErr || !row) {
    await admin.storage.from('style-anchor-memos').remove([storagePath]).catch(() => {})
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({
    ...row,
    extracted: !!text,
    extracted_text_length: text?.length ?? 0,
  })
}

// ---------------------------------------------------------------------------

interface ReadMetaResult {
  title?: string
  anonymized?: boolean
  vintage_year?: number
  vintage_quarter?: string
  sector?: string
  deal_stage_at_writing?: string
  outcome?: typeof OUTCOMES[number]
  conviction_at_writing?: typeof CONVICTIONS[number]
  voice_representativeness?: typeof VOICE_LEVELS[number]
  authorship?: string
  author_initials?: string
  focus_attention_on?: string[]
  deprioritize_in_this_memo?: string[]
  partner_notes?: string
}

function readMeta(form: FormData): ReadMetaResult {
  const out: ReadMetaResult = {}
  const get = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }

  if (get('title')) out.title = get('title')
  const anon = form.get('anonymized')
  if (anon === 'true' || anon === '1') out.anonymized = true
  const vy = get('vintage_year')
  if (vy && /^\d{4}$/.test(vy)) out.vintage_year = parseInt(vy, 10)
  const vq = get('vintage_quarter')
  if (vq && QUARTERS.includes(vq as any)) out.vintage_quarter = vq
  if (get('sector')) out.sector = get('sector')
  if (get('deal_stage_at_writing')) out.deal_stage_at_writing = get('deal_stage_at_writing')
  const outcome = get('outcome')
  if (outcome && OUTCOMES.includes(outcome as any)) out.outcome = outcome as any
  const conv = get('conviction_at_writing')
  if (conv && CONVICTIONS.includes(conv as any)) out.conviction_at_writing = conv as any
  const voice = get('voice_representativeness')
  if (voice && VOICE_LEVELS.includes(voice as any)) out.voice_representativeness = voice as any
  if (get('authorship')) out.authorship = get('authorship')
  if (get('author_initials')) out.author_initials = get('author_initials')
  const focus = form.getAll('focus_attention_on').map(v => String(v)).filter(Boolean)
  if (focus.length) out.focus_attention_on = focus
  const depri = form.getAll('deprioritize_in_this_memo').map(v => String(v)).filter(Boolean)
  if (depri.length) out.deprioritize_in_this_memo = depri
  if (get('partner_notes')) out.partner_notes = get('partner_notes')

  return out
}

async function ensureAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  if ((membership as any).role !== 'admin') return { error: NextResponse.json({ error: 'Admin required' }, { status: 403 }) }
  return { admin, fundId: (membership as any).fund_id as string, userId: user.id }
}
