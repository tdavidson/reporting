import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const FIELD_DESCRIPTIONS = `
Extraia os seguintes campos do documento (retorne null se não encontrar):

IDENTIDADE DO FUNDO:
- fund_name: Nome completo do fundo
- cnpj: CNPJ do fundo (formato: XX.XXX.XXX/XXXX-XX)
- vintage: Ano de vintagem (número inteiro, ex: 2021)

PARTES:
- gp_name: Nome do Gestor/GP
- lp_names: Nome(s) dos cotistas/LPs (separados por vírgula se múltiplos)
- fund_administrator: Nome do Administrador do fundo
- auditor: Nome da empresa de auditoria
- legal_counsel: Nome do assessor jurídico

TERMOS ECONÔMICOS:
- management_fee_rate: Taxa de administração como decimal (ex: 0.02 para 2%)
- management_fee_basis: Base de cálculo da taxa (ex: "capital comprometido", "capital investido", "NAV")
- carry_rate: Taxa de performance/carry como decimal (ex: 0.20 para 20%)
- hurdle_rate: Taxa mínima de retorno (hurdle) como decimal (ex: 0.08 para 8%)
- hurdle_type: Tipo de hurdle (ex: "retorno preferencial", "IRR hurdle")
- catch_up_rate: Taxa de catch-up como decimal
- waterfall_type: Tipo de waterfall (ex: "europeu", "americano")
- gp_commit_pct: Percentual de comprometimento do GP como decimal (ex: 0.01 para 1%)
- recycling_allowed: true ou false — se reciclagem de capital é permitida
- recycling_cap: Limite de reciclagem em valor absoluto (número)

PRAZO E ESTRUTURA:
- term_years: Prazo total do fundo em anos (número inteiro)
- investment_period_years: Período de investimento em anos (número inteiro)
- extension_options: Opções de extensão de prazo (texto, ex: "2 prorrogações de 1 ano")

RELATÓRIOS:
- reporting_frequency: Frequência de relatórios (ex: "trimestral", "semestral", "anual")
- audit_required: true ou false — se auditoria é obrigatória

IMPORTANTE:
- Todos os valores de texto devem estar em português
- Taxas percentuais devem ser retornadas como decimais (20% = 0.20)
- Se um campo não for encontrado no documento, retorne null
- Não invente valores — apenas extraia o que está explicitamente no documento
`

async function extractTextFromBuffer(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const isDocx =
    mimeType.includes('officedocument') ||
    mimeType.includes('wordprocessingml') ||
    filename.toLowerCase().endsWith('.docx') ||
    filename.toLowerCase().endsWith('.doc')

  const isPdf =
    mimeType.includes('pdf') ||
    filename.toLowerCase().endsWith('.pdf')

  if (isDocx) {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  if (isPdf) {
    const pdfParse = (await import('pdf-parse')).default
    const data = await pdfParse(buffer)
    return data.text
  }

  throw new Error('Formato não suportado. Use PDF ou DOCX.')
}

async function fetchDocumentText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Falha ao buscar documento: ${res.status}`)
  const contentType = res.headers.get('content-type') ?? ''
  const buffer = Buffer.from(await res.arrayBuffer())
  return extractTextFromBuffer(buffer, url, contentType)
}

async function extractFields(text: string): Promise<Record<string, any>> {
  const truncated = text.slice(0, 80000)

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Você é um especialista em análise de regulamentos e contratos de fundos de investimento brasileiros.\n\nAnalise o seguinte documento e extraia as informações solicitadas.\n\n${FIELD_DESCRIPTIONS}\n\nRetorne APENAS um objeto JSON válido com os campos extraídos. Sem explicações, sem markdown, apenas o JSON puro.\n\nDOCUMENTO:\n${truncated}`,
    }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Agent 1 não retornou JSON válido')
  return JSON.parse(jsonMatch[0])
}

async function reviewFields(extracted: Record<string, any>, text: string): Promise<Record<string, any>> {
  const truncated = text.slice(0, 40000)

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Você é um revisor especializado em fundos de investimento. Outro agente extraiu os seguintes dados de um regulamento:\n\nDADOS EXTRAÍDOS:\n${JSON.stringify(extracted, null, 2)}\n\n${FIELD_DESCRIPTIONS}\n\nSua tarefa:\n1. Verifique se os valores fazem sentido (ex: taxa de carry de 0.20 = 20% é razoável; 20.0 = 2000% não faz sentido)\n2. Corrija inconsistências (ex: taxas que foram extraídas como % em vez de decimal)\n3. Confirme ou corrija os valores verificando o trecho do documento abaixo\n4. Se um valor estiver claramente errado, corrija. Se estiver incerto, mantenha null\n5. Todos os textos em português\n\nRetorne APENAS o JSON corrigido. Sem explicações, apenas JSON puro.\n\nTRECHO DO DOCUMENTO (para verificação):\n${truncated}`,
    }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return extracted
  return JSON.parse(jsonMatch[0])
}

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
    // File upload path
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
    // Legacy URL path
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

  try {
    const text = await extractTextFromBuffer(buffer, filename, mimeType)
    if (!text || text.length < 100) {
      return NextResponse.json({ error: 'Documento vazio ou ilegível' }, { status: 422 })
    }

    const extracted = await extractFields(text)
    const reviewed = await reviewFields(extracted, text)

    const termFields = [
      'fund_name', 'cnpj', 'vintage',
      'gp_name', 'lp_names', 'fund_administrator', 'auditor', 'legal_counsel',
      'management_fee_rate', 'management_fee_basis', 'carry_rate',
      'hurdle_rate', 'hurdle_type', 'catch_up_rate', 'waterfall_type',
      'gp_commit_pct', 'recycling_allowed', 'recycling_cap',
      'term_years', 'investment_period_years', 'extension_options',
      'reporting_frequency', 'audit_required',
    ]

    const upsertPayload: Record<string, any> = {
      fund_id: membership.fund_id,
      portfolio_group: portfolioGroup,
      updated_at: new Date().toISOString(),
    }

    for (const field of termFields) {
      if (reviewed[field] !== undefined && reviewed[field] !== null) {
        upsertPayload[field] = reviewed[field]
      }
    }

    const { error: upsertErr } = await admin
      .from('fund_contract_terms' as any)
      .upsert(upsertPayload, { onConflict: 'fund_id,portfolio_group' })

    if (upsertErr) return dbError(upsertErr, 'fund-contract-analyze-upsert')

    await admin.from('fund_contract_documents' as any).insert({
      fund_id: membership.fund_id,
      portfolio_group: portfolioGroup,
      name: docName,
      doc_type: docType,
      url: null, // file upload — no public URL
      notes: 'Importado e analisado por IA',
    })

    return NextResponse.json({ ok: true, fields: reviewed })
  } catch (err: any) {
    console.error('[fund-contracts/analyze]', err)
    return NextResponse.json({ error: err.message ?? 'Erro interno' }, { status: 500 })
  }
}
