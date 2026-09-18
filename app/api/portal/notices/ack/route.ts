import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'

/**
 * LP portal — "we've wired": the partner's acknowledgment of a capital call notice.
 *
 *   POST { lineId, wiredOn?: 'YYYY-MM-DD', reference?, note? }
 *
 * Recorded on the register line for the GP to see and for the bank matcher to use as a tiebreak.
 * It is the partner's word, not a settlement: the money is settled when the ledger says so.
 * Scoped to lines belonging to the signed-in LP's own entities, in funds with the portal on.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds, lpAccountId } = access
  if (investorIds.length === 0) return NextResponse.json({ error: 'No access' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const lineId = typeof body.lineId === 'string' ? body.lineId : ''
  if (!lineId) return NextResponse.json({ error: 'lineId is required' }, { status: 400 })
  const wiredOn = typeof body.wiredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.wiredOn) ? body.wiredOn : null
  const reference = typeof body.reference === 'string' ? body.reference.trim().slice(0, 120) : ''
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : ''

  const { data: line } = await admin
    .from('capital_call_lines').select('id, fund_id, lp_entity_id').eq('id', lineId).maybeSingle()
  if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The line must belong to one of the LP's own entities, in a fund whose portal is on.
  const [{ data: entity }, { data: fs }] = await Promise.all([
    admin.from('lp_entities').select('id').eq('id', line.lp_entity_id).in('investor_id', investorIds).maybeSingle(),
    admin.from('fund_settings').select('lp_portal_enabled').eq('fund_id', line.fund_id).maybeSingle(),
  ])
  if (!entity || !fs?.lp_portal_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('capital_call_lines').update({
    ack_at: new Date().toISOString(),
    ack_wired_on: wiredOn,
    ack_reference: reference || null,
    ack_note: note || null,
    ack_lp_account_id: lpAccountId,
  }).eq('id', lineId)
  if (error) return NextResponse.json({ error: 'Could not record the acknowledgment' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
