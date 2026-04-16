import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FundContractTerms {
  portfolio_group: string
  fund_id: string
  // Fund identity
  fund_name: string | null
  cnpj: string | null
  // Parties
  gp_name: string | null
  lp_names: string | null
  fund_administrator: string | null
  auditor: string | null
  legal_counsel: string | null
  // Economic terms
  management_fee_rate: number | null
  management_fee_basis: string | null  // 'committed' | 'invested' | 'nav'
  carry_rate: number | null
  hurdle_rate: number | null
  hurdle_type: string | null           // free text, e.g. 'Preferred Return', 'IRR Hurdle'
  catch_up_rate: number | null
  waterfall_type: string | null        // 'european' | 'american'
  gp_commit_pct: number | null
  recycling_allowed: boolean | null
  recycling_cap: number | null
  // Duration
  vintage: number | null
  term_years: number | null
  investment_period_years: number | null
  extension_options: string | null
  // Reporting
  reporting_frequency: string | null   // 'quarterly' | 'semi-annual' | 'annual'
  audit_required: boolean | null
  // Timestamps
  created_at: string
  updated_at: string
}

export interface FundContractDocument {
  id: string
  portfolio_group: string
  fund_id: string
  name: string
  doc_type: string   // 'LPA' | 'SPA' | 'NDA' | 'Side Letter' | 'Amendment' | 'Other'
  version: string | null
  effective_date: string | null
  url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// GET — fetch terms + documents for the fund (all groups or ?group=)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
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

  const group = req.nextUrl.searchParams.get('group')

  let termsQuery = admin
    .from('fund_contract_terms' as any)
    .select('*')
    .eq('fund_id', membership.fund_id)

  let docsQuery = admin
    .from('fund_contract_documents' as any)
    .select('*')
    .eq('fund_id', membership.fund_id)
    .order('effective_date', { ascending: false })

  if (group) {
    termsQuery = termsQuery.eq('portfolio_group', group) as any
    docsQuery = docsQuery.eq('portfolio_group', group) as any
  }

  const [{ data: terms, error: termsErr }, { data: docs, error: docsErr }] = await Promise.all([
    termsQuery as any,
    docsQuery as any,
  ])

  if (termsErr) return dbError(termsErr, 'fund-contract-terms-get')
  if (docsErr) return dbError(docsErr, 'fund-contract-docs-get')

  return NextResponse.json({ terms: terms ?? [], documents: docs ?? [] })
}

// ---------------------------------------------------------------------------
// PUT — upsert contract terms for a portfolio_group
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest) {
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

  const body = await req.json()
  const { portfolioGroup, ...rest } = body

  if (!portfolioGroup) return NextResponse.json({ error: 'portfolioGroup is required' }, { status: 400 })

  const upsertPayload: Record<string, any> = {
    fund_id: membership.fund_id,
    portfolio_group: portfolioGroup,
    updated_at: new Date().toISOString(),
  }

  const termFields = [
    'fund_name', 'cnpj',
    'gp_name', 'lp_names', 'fund_administrator', 'auditor', 'legal_counsel',
    'management_fee_rate', 'management_fee_basis', 'carry_rate',
    'hurdle_rate', 'hurdle_type', 'catch_up_rate', 'waterfall_type',
    'gp_commit_pct', 'recycling_allowed', 'recycling_cap',
    'vintage', 'term_years', 'investment_period_years',
    'extension_options', 'reporting_frequency', 'audit_required',
  ]

  // Accept both snake_case and camelCase from client
  for (const field of termFields) {
    const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    if (rest[field] !== undefined) upsertPayload[field] = rest[field]
    else if (rest[camel] !== undefined) upsertPayload[field] = rest[camel]
  }

  const { data, error } = await admin
    .from('fund_contract_terms' as any)
    .upsert(upsertPayload, { onConflict: 'fund_id,portfolio_group' })
    .select('*')
    .single() as { data: any; error: { message: string } | null }

  if (error) return dbError(error, 'fund-contract-terms-upsert')
  return NextResponse.json(data)
}

// ---------------------------------------------------------------------------
// POST — create a new document entry
// ---------------------------------------------------------------------------

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

  const body = await req.json()
  const { portfolioGroup, name, docType, version, effectiveDate, url, notes } = body

  if (!portfolioGroup || !name) {
    return NextResponse.json({ error: 'portfolioGroup and name are required' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('fund_contract_documents' as any)
    .insert({
      fund_id: membership.fund_id,
      portfolio_group: portfolioGroup,
      name,
      doc_type: docType ?? 'Other',
      version: version ?? null,
      effective_date: effectiveDate ?? null,
      url: url ?? null,
      notes: notes ?? null,
    })
    .select('*')
    .single() as { data: any; error: { message: string } | null }

  if (error) return dbError(error, 'fund-contract-docs-create')
  return NextResponse.json(data)
}

// ---------------------------------------------------------------------------
// DELETE — remove a document by id
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
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

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await admin
    .from('fund_contract_documents' as any)
    .delete()
    .eq('id', id)
    .eq('fund_id', membership.fund_id)

  if (error) return dbError(error, 'fund-contract-docs-delete')
  return NextResponse.json({ ok: true })
}
