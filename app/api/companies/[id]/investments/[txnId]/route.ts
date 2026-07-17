import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { logActivity } from '@/lib/activity'
import { redraftEntryForTransaction, retractEntriesForTransaction } from '@/lib/accounting/from-portfolio'
import { normalizeSecurityType, SECURITY_TYPES } from '@/lib/accounting/soi'

// ---------------------------------------------------------------------------
// PATCH — update a transaction
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; txnId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Verify transaction exists and belongs to this company
  const { data: existing } = await admin
    .from('investment_transactions' as any)
    .select('id, company_id, fund_id')
    .eq('id', params.txnId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; company_id: string; fund_id: string } | null }

  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  // Verify the transaction's fund matches the user's fund
  if (existing.fund_id !== writeCheck.fundId) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  const body = await req.json()

  // Only allow updating known fields
  const allowedFields = [
    'round_name', 'transaction_date', 'notes',
    'investment_cost', 'interest_converted', 'shares_acquired', 'share_price',
    'cost_basis_exited', 'proceeds_received', 'proceeds_escrow',
    'proceeds_written_off', 'proceeds_per_share',
    'unrealized_value_change', 'current_share_price',
    'postmoney_valuation', 'ownership_pct', 'latest_postmoney_valuation', 'exit_valuation',
    'original_currency',
    'original_investment_cost', 'original_share_price', 'original_postmoney_valuation',
    'original_proceeds_received', 'original_proceeds_per_share', 'original_exit_valuation',
    'original_unrealized_value_change', 'original_current_share_price',
    'original_latest_postmoney_valuation',
    'valuation_change_source', 'fx_rate', 'prior_fx_rate', 'fx_value_change',
    'original_position_value',
    'portfolio_group',
    // The Schedule of Investments reads `security_type` for its by-asset-type breakout, but
    // it was in no create route, no allowlist and no import — so nothing in the app could
    // ever set it, and the breakout fell back to a two-bucket guess forever.
    'security_type',
    // Convertible-note terms. `interest_rate` is the ONLY rate the ledger accrues on.
    // `dividend_rate` is preferred-equity dividends: they accrue to the liquidation preference,
    // not to income, and never touch the books.
    'interest_rate', 'maturity_date', 'dividend_rate',
    // The conversion link (which SAFE/note this priced round converted). Editing a conversion
    // re-drafts its ledger entry from the new values, same as any other investment edit.
    'converts_from_txn_id',
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key]
  }

  // Same CHECK constraint as the create route: reject in words rather than let Postgres reject it
  // in a 500. Null stays null — that's how you clear the instrument back to the derived fallback.
  if (body.security_type != null && body.security_type !== '') {
    const security_type = normalizeSecurityType(body.security_type)
    if (!security_type) {
      return NextResponse.json(
        { error: `Invalid security_type "${body.security_type}". Must be one of: ${SECURITY_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    updates.security_type = security_type
  } else if ('security_type' in body) {
    updates.security_type = null
  }

  const { data: txn, error } = await admin
    .from('investment_transactions' as any)
    .update(updates)
    .eq('id', params.txnId)
    .select('*')
    .single()

  if (error) return dbError(error, 'companies-id-investments-txnId-patch')

  logActivity(admin, existing.fund_id, user.id, 'investment.update', {
    companyId: params.id,
    transactionId: params.txnId,
  })

  // Re-mirror the ledger. Creating a transaction drafted a journal entry, but editing one
  // used to change nothing on the books — so correcting a fat-fingered cost left the ledger
  // permanently wrong, with only a passive variance warning to notice, and no way to tell why.
  const { data: company } = await admin
    .from('companies' as any)
    .select('name')
    .eq('id', params.id)
    .maybeSingle() as { data: { name: string } | null }

  const ledger = await redraftEntryForTransaction(
    admin, existing.fund_id, user.id, txn, company?.name ?? 'Investment'
  )

  return NextResponse.json({ ...(txn as object), ledger })
}

// ---------------------------------------------------------------------------
// DELETE — delete a transaction
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; txnId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Verify transaction exists and belongs to this company
  const { data: existing } = await admin
    .from('investment_transactions' as any)
    .select('id, company_id, fund_id')
    .eq('id', params.txnId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; company_id: string; fund_id: string } | null }

  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  // Verify the transaction's fund matches the user's fund
  if (existing.fund_id !== writeCheck.fundId) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  // Retract the ledger side FIRST. If its journal entry sits in a closed period we refuse the
  // whole delete — otherwise the tracker would lose a transaction the books still carry, and
  // the two would disagree with nothing to explain why. Deleting the tracker row first and
  // then failing here would leave exactly that mess.
  const ledger = await retractEntriesForTransaction(admin, existing.fund_id, params.txnId)
  if (ledger.reason) {
    return NextResponse.json({ error: `Can't delete this transaction. ${ledger.reason}` }, { status: 400 })
  }

  const { error } = await admin
    .from('investment_transactions' as any)
    .delete()
    .eq('id', params.txnId)

  if (error) return dbError(error, 'companies-id-investments-txnId-delete')

  logActivity(admin, existing.fund_id, user.id, 'investment.delete', {
    companyId: params.id,
    transactionId: params.txnId,
  })

  return NextResponse.json({ success: true, ledger })
}
