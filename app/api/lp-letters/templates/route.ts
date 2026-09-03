import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { DEFAULT_STYLE_GUIDE, DEFAULT_TEMPLATE_NAME } from '@/lib/lp-letters/default-template'
import { extractFromBuffer } from '@/lib/parsing/extractAttachmentText'
import { createFundAIProvider } from '@/lib/ai'
import { logAIUsage } from '@/lib/ai/usage'
import { analyzeTemplate } from '@/lib/lp-letters/generate'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const { data, error } = await admin
    .from('lp_letter_templates')
    .select('*')
    .eq('fund_id', membership.fund_id)
    .order('created_at', { ascending: false })

  if (error) return dbError(error, 'lp-letters-templates')

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const contentType = req.headers.get('content-type') ?? ''

  // Handle file upload (multipart) or JSON (use default)
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const name = (formData.get('name') as string) ?? 'Custom Template'

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    // Reject files over 20MB before buffering into memory
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const extracted = await extractFromBuffer(buffer, file.name, file.type)

    if (!extracted.extractedText) {
      return NextResponse.json({ error: 'Could not extract text from file' }, { status: 400 })
    }

    // Analyze the template using AI
    const { provider, model, providerType } = await createFundAIProvider(admin, fundId)
    const { styleGuide, usage } = await analyzeTemplate(provider, model, extracted.extractedText)

    await logAIUsage(admin, {
      fundId,
      userId: user.id,
      provider: providerType,
      model,
      feature: 'lp-letter-template-analysis',
      usage,
    })

    const sourceFormat = file.name.endsWith('.docx') ? 'docx' : 'pdf'

    const { data, error } = await admin
      .from('lp_letter_templates')
      .insert({
        fund_id: fundId,
        name,
        style_guide: styleGuide,
        source_filename: file.name,
        source_type: 'upload',
        source_format: sourceFormat,
        source_text: extracted.extractedText.slice(0, 100_000),
        is_default: false,
      })
      .select()
      .single()

    if (error) return dbError(error, 'lp-letters-templates')
    return NextResponse.json(data, { status: 201 })
  }

  // JSON body — create default template
  const body = await req.json().catch(() => ({}))
  const name = body.name ?? DEFAULT_TEMPLATE_NAME

  const { data, error } = await admin
    .from('lp_letter_templates')
    .insert({
      fund_id: fundId,
      name,
      style_guide: DEFAULT_STYLE_GUIDE,
      source_type: 'default',
      is_default: true,
    })
    .select()
    .single()

  if (error) return dbError(error, 'lp-letters-templates')
  return NextResponse.json(data, { status: 201 })
}
