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

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 20 MB limit' }, { status: 400 })
  }

  const safeName = file.name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
  const ext = (safeName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  if (!ALLOWED_FORMATS.includes(ext as any)) {
    return NextResponse.json({
      error: `Unsupported format ".${ext}". Allowed: PDF, DOCX, MD.`,
    }, { status: 400 })
  }

  // Read the file once.
  const buffer = Buffer.from(await file.arrayBuffer())
  const storagePath = `${fundId}/${Date.now()}_${safeName}`

  // Upload to storage first; if extraction fails we still keep the file so
  // the partner can retry text extraction later.
  const { error: uploadErr } = await admin.storage
    .from('style-anchor-memos')
    .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  // Run text extraction inline. ≤20 MB fits comfortably in a Vercel function.
  const text = await extractText(buffer, ext)

  // Pull metadata fields off the form (all optional).
  const meta = readMeta(formData)

  const insert: Record<string, unknown> = {
    fund_id: fundId,
    storage_path: storagePath,
    file_name: safeName,
    file_format: ext === 'markdown' ? 'md' : (ext === 'txt' ? 'md' : ext),
    file_size_bytes: file.size,
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
