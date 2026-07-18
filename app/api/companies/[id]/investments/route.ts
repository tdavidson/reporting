import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { logActivity } from '@/lib/activity'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'
import type { CompanyInvestmentSummary } from '@/lib/types/investments'
import { computeSummary } from '@/lib/investments'
import { draftEntryForTransaction } from '@/lib/accounting/from-portfolio'
import { validateConversionLink } from '@/lib/accounting/conversion-link'
import { normalizeSecurityType, SECURITY_TYPES } from '@/lib/accounting/soi'

// ---------------------------------------------------------------------------
// GET — all transactions for a company + computed summary
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Verify company exists and user has access
  const { data: company } = await admin
    .from('companies')
    .select('id, fund_id, status, portfolio_group')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const { data: transactions, error } = await admin
    .from('investment_transactions' as any)
    .select('*')
    .eq('company_id', params.id)
    .order('transaction_date', { ascending: true }) as { data: InvestmentTransaction[] | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies-id-investments')

  const txns = (transactions ?? []) as InvestmentTransaction[]
  const asOf = _req.nextUrl.searchParams.get('asOf')
  const asOfDate = asOf ? new Date(asOf) : new Date()
  const summary = computeSummary(txns, company.status as CompanyStatus, asOfDate)

  // Compute per-group summaries when there are multiple groups
  const portfolioGroups: string[] = company.portfolio_group ?? []
  const groupsInTxns = new Set(txns.map(t => t.portfolio_group ?? '').filter(Boolean))
  const hasMultipleGroups = groupsInTxns.size > 1

  let groupSummaries: Record<string, CompanyInvestmentSummary> | undefined
  if (hasMultipleGroups) {
    groupSummaries = {}
    // round_info and unrealized_gain_change without a portfolio_group are company-wide;
    // include them in every group so share prices propagate correctly
    const companyWideTxns = txns.filter(t =>
      !t.portfolio_group && (t.transaction_type === 'round_info' || t.transaction_type === 'unrealized_gain_change')
    )
    for (const group of Array.from(groupsInTxns)) {
      const groupTxns = [...txns.filter(t => t.portfolio_group === group), ...companyWideTxns]
      groupSummaries[group] = computeSummary(groupTxns, company.status as CompanyStatus, asOfDate)
    }
  }

  return NextResponse.json({ transactions: txns, summary, portfolioGroups, groupSummaries })
}

// ---------------------------------------------------------------------------
// POST — create a new transaction
// ---------------------------------------------------------------------------

const VALID_TYPES = ['investment', 'proceeds', 'unrealized_gain_change', 'round_info']

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Verify company exists
  const { data: company } = await admin
    .from('companies')
    .select('id, fund_id, name')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const body = await req.json()
  const { transaction_type } = body

  if (!transaction_type || !VALID_TYPES.includes(transaction_type)) {
    return NextResponse.json({ error: 'Invalid transaction_type' }, { status: 400 })
  }

  // security_type is CHECK-constrained. Unvalidated, a bad value reached Postgres and came back as
  // a raw constraint violation the user saw as "An unexpected error occurred" — so say what's wrong
  // here instead. Normalizing first keeps "Convertible Note" from an API caller working.
  const security_type = body.security_type ? normalizeSecurityType(body.security_type) : null
  if (body.security_type && !security_type) {
    return NextResponse.json(
      { error: `Invalid security_type "${body.security_type}". Must be one of: ${SECURITY_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  // A conversion links to the SAFE/note it converts. Validate the link the same way here and in
  // PATCH — a dangling or cross-company id would silently break the basis carry and the ledger entry.
  const convertsFrom: string | null = body.converts_from_txn_id ?? null
  if (convertsFrom) {
    const linkError = await validateConversionLink(admin, params.id, convertsFrom, transaction_type)
    if (linkError) return NextResponse.json({ error: linkError }, { status: 400 })
  }

  const { data: txn, error } = await admin
    .from('investment_transactions' as any)
    .insert({
      company_id: params.id,
      fund_id: company.fund_id,
      transaction_type: body.transaction_type,
      // Non-null on a conversion: this investment row is the priced round a SAFE/note became.
      converts_from_txn_id: convertsFrom,
      round_name: body.round_name ?? null,
      transaction_date: body.transaction_date ?? null,
      notes: body.notes ?? null,
      investment_cost: body.investment_cost ?? null,
      interest_converted: body.interest_converted ?? 0,
      shares_acquired: body.shares_acquired ?? null,
      share_price: body.share_price ?? null,
      cost_basis_exited: body.cost_basis_exited ?? null,
      proceeds_received: body.proceeds_received ?? null,
      proceeds_escrow: body.proceeds_escrow ?? 0,
      proceeds_written_off: body.proceeds_written_off ?? 0,
      proceeds_per_share: body.proceeds_per_share ?? null,
      unrealized_value_change: body.unrealized_value_change ?? null,
      current_share_price: body.current_share_price ?? null,
      postmoney_valuation: body.postmoney_valuation ?? null,
      ownership_pct: body.ownership_pct ?? null,
      latest_postmoney_valuation: body.latest_postmoney_valuation ?? null,
      exit_valuation: body.exit_valuation ?? null,
      original_currency: body.original_currency ?? null,
      original_investment_cost: body.original_investment_cost ?? null,
      original_share_price: body.original_share_price ?? null,
      original_postmoney_valuation: body.original_postmoney_valuation ?? null,
      original_proceeds_received: body.original_proceeds_received ?? null,
      original_proceeds_per_share: body.original_proceeds_per_share ?? null,
      original_exit_valuation: body.original_exit_valuation ?? null,
      original_unrealized_value_change: body.original_unrealized_value_change ?? null,
      original_current_share_price: body.original_current_share_price ?? null,
      original_latest_postmoney_valuation: body.original_latest_postmoney_valuation ?? null,
      valuation_change_source: body.valuation_change_source ?? null,
      fx_rate: body.fx_rate ?? null,
      prior_fx_rate: body.prior_fx_rate ?? null,
      fx_value_change: body.fx_value_change ?? null,
      original_position_value: body.original_position_value ?? null,
      portfolio_group: body.portfolio_group ?? null,
      // Feeds the SOI's by-asset-type breakout. The column existed and soi.ts read it, but no
      // route ever wrote it, so the breakout fell back to a derived two-bucket guess forever.
      security_type,
      // Convertible-note terms. The close accrues interest on `interest_rate` only.
      // `dividend_rate` (preferred dividends) accrues to the liquidation preference and is
      // deliberately invisible to the ledger — an undeclared preferred dividend is not income.
      interest_rate: body.interest_rate ?? null,
      maturity_date: body.maturity_date ?? null,
      dividend_rate: body.dividend_rate ?? null,
    })
    .select('*')
    .single() as { data: InvestmentTransaction | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies-id-investments-post')

  logActivity(admin, company.fund_id, user.id, 'investment.create', {
    companyId: params.id,
    transactionType: transaction_type,
  })

  // Mirror it into the ledger as a DRAFT for review. Deliberately after the insert and
  // deliberately non-fatal: the transaction is saved either way, and `ledger.reason`
  // says why no entry was drafted (vehicle not on the ledger, a closed period, a
  // company-wide pricing row with no vehicle to attribute it to).
  const ledger = await draftEntryForTransaction(
    admin,
    company.fund_id,
    user.id,
    txn,
    (company as any).name ?? 'Investment',
  )

  return NextResponse.json({ ...txn, ledger })
}
