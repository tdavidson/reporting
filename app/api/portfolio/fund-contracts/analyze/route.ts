import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Você é um especialista em análise de regulamentos e contratos de fundos de investimento brasileiros (FIPs, FIEMs, FIDCs, etc).

Sua tarefa é extrair campos estruturados de documentos como Regulamentos, LPAs, SPAs e Side Letters.

Regras críticas:
- Extraia APENAS o que está explicitamente no documento. Nunca invente ou deduza valores.
- Taxas percentuais devem ser retornadas como unidade (2% = 2, 20% = 20).
- Se um campo não existir no documento, retorne null.
- Textos de descrição em português.
- Retorne APENAS JSON puro, sem markdown, sem explicações.`

const EXTRACTION_PROMPT = `Analise este documento e extraia os seguintes campos:

{
  "fund_name": "Nome completo do fundo",
  "cnpj": "CNPJ no formato XX.XXX.XXX/XXXX-XX ou null",
  "vintage": ano_inteiro_ou_null,

  "gp_name": "Nome do Gestor/GP",
  "lp_names": "Cotistas/LPs separados por vírgula",
  "fund_administrator": "Nome do Administrador",
  "auditor": "Empresa de auditoria",
  "legal_counsel": "Assessor jurídico",

  "management_fee_rate": decimal_ou_null,
  "management_fee_basis": "Base de cálculo (ex: capital comprometido, NAV)",
  "carry_rate": decimal_ou_null,
  "hurdle_rate": decimal_ou_null,
  "hurdle_type": "Tipo de hurdle (ex: retorno preferencial, IRR)",
  "catch_up_rate": decimal_ou_null,
  "waterfall_type": "europeu ou americano",
  "gp_commit_pct": decimal_ou_null,
  "recycling_allowed": true_false_ou_null,
  "recycling_cap": numero_absoluto_ou_null,

  "term_years": inteiro_ou_null,
  "investment_period_years": inteiro_ou_null,
  "extension_options": "Descrição das opções de prorrogação",
  "reporting_frequency": "trimestral / semestral / anual",
  "audit_required": true_false_ou_null
}

Exemplos de taxas corretas:
- "taxa de administração de 2% ao ano" → management_fee_rate: 2
- "taxa de performance de 20%" → carry_rate: 20  
- "hurdle de 8% a.a." → hurdle_rate: 8
- "GP commit de 1%" → gp_commit_pct: 1`

async function extractFromPdfNative(buffer: Buffer): Promise<Record<string, any>> {
  const base64 = buffer.toString('base64')

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI não retornou JSON válido')
  return JSON.parse(jsonMatch[0])
}

async function extractFromText(text: string): Promise<Record<string, any>> {
  // For DOCX or when PDF text extraction is needed as fallback
  const truncated = text.slice(0, 100_000)

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${EXTRACTION_PROMPT}\n\nDOCUMENTO:\n${truncated}`,
    }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI não retornou JSON válido')
  return JSON.parse(jsonMatch[0])
}

async function extractFromBuffer(buffer: Buffer, filename: string, mimeType: string): Promise<Record<string, any>> {
  const isPdf =
    mimeType.includes('pdf') ||
    filename.toLowerCase().endsWith('.pdf')

  const isDocx =
    mimeType.includes('officedocument') ||
    mimeType.includes('wordprocessingml') ||
    filename.toLowerCase().endsWith('.docx') ||
    filename.toLowerCase().endsWith('.doc')

  if (isPdf) {
    // Use native PDF reading — far superior to text extraction
    return extractFromPdfNative(buffer)
  }

  if (isDocx) {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ buffer })
    if (!result.value || result.value.length < 100) {
      throw new Error('Documento vazio ou ilegível')
    }
    return extractFromText(result.value)
  }

  throw new Error('Formato não suportado. Use PDF ou DOCX.')
}

const TERM_FIELDS = [
  'fund_name', 'cnpj', 'vintage',
  'gp_name', 'lp_names', 'fund_administrator', 'auditor', 'legal_counsel',
  'management_fee_rate', 'management_fee_basis', 'carry_rate',
  'hurdle_rate', 'hurdle_type', 'catch_up_rate', 'waterfall_type',
  'gp_commit_pct', 'recycling_allowed', 'recycling_cap',
  'term_years', 'investment_period_years', 'extension_options',
  'reporting_frequency', 'audit_required',
]

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const contentType = req.headers.get('content-type') ?? ''
  let buffer: Buffer
  let filename = 'documento'
  let mimeType = ''
  let portfolioGroup = ''
  let docName = 'Regulamento'
  let docType = 'LPA'

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
    portfolioGroup = (formData.get('portfolioGroup') as string) ?? ''
    docName = (formData.get('docName') as string) || file.name || 'Regulamento'
    docType = (formData.get('docType') as string) || 'LPA'
    filename = file.name
    mimeType = file.type
    buffer = Buffer.from(await file.arrayBuffer())
  } else {
    const body = await req.json()
    const { url, portfolioGroup: pg, docName: dn, docType: dt } = body
    if (!url || !pg) return NextResponse.json({ error: 'url e portfolioGroup são obrigatórios' }, { status: 400 })
    portfolioGroup = pg
    docName = dn ?? 'Regulamento'
    docType = dt ?? 'LPA'
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return NextResponse.json({ error: `Falha ao buscar documento: ${res.status}` }, { status: 422 })
    mimeType = res.headers.get('content-type') ?? ''
    buffer = Buffer.from(await res.arrayBuffer())
    filename = url
  }

  if (!portfolioGroup) return NextResponse.json({ error: 'portfolioGroup é obrigatório' }, { status: 400 })

  // Reject files over 30MB
  if (buffer.length > 30 * 1024 * 1024) {
    return NextResponse.json({ error: 'Arquivo muito grande (máx 30MB)' }, { status: 400 })
  }

  try {
    const fields = await extractFromBuffer(buffer, filename, mimeType)

    const upsertPayload: Record<string, any> = {
      fund_id: membership.fund_id,
      portfolio_group: portfolioGroup,
      updated_at: new Date().toISOString(),
    }

    for (const field of TERM_FIELDS) {
      if (fields[field] !== undefined && fields[field] !== null) {
        upsertPayload[field] = fields[field]
      }
    }

    const { error: upsertErr } = await admin
      .from('fund_contract_terms' as any)
      .upsert(upsertPayload, { onConflict: 'fund_id,portfolio_group' })

    if (upsertErr) return dbError(upsertErr, 'fund-contract-analyze-upsert')

let signedUrl: string | null = null
let storagePath: string | null = null
try {
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'pdf'
  const storageKey = `${membership.fund_id}/${portfolioGroup}/${Date.now()}_${docName}.${ext}`
  const { error: uploadErr } = await admin.storage
    .from('fund-contracts')
    .upload(storageKey, buffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: false,
    })
  if (!uploadErr) {
    storagePath = storageKey
    const { data: signed } = await admin.storage
      .from('fund-contracts')
      .createSignedUrl(storageKey, 60 * 60 * 24 * 365)
    signedUrl = signed?.signedUrl ?? null
  }
} catch {
  // non-critical
}

await admin.from('fund_contract_documents' as any).insert({
  fund_id: membership.fund_id,
  portfolio_group: portfolioGroup,
  name: docName,
  doc_type: docType,
  url: signedUrl,
  storage_path: storagePath,
  notes: 'Importado e analisado por IA',
})

    return NextResponse.json({ ok: true, fields })
  } catch (err: any) {
    console.error('[fund-contracts/analyze]', err)
    return NextResponse.json({ error: err.message ?? 'Erro interno' }, { status: 500 })
  }
}
