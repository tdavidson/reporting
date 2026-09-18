import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { listCapitalCalls } from '@/lib/accounting/capital-calls'
import { listDistributions } from '@/lib/accounting/distributions'
import { getSelfReadState } from '@/lib/lp-access-log'

export interface PortalNotice {
  kind: 'capital_call' | 'distribution'
  lineId: string
  fundId: string
  vehicle: string
  date: string
  number: number | null
  description: string | null
  dueDate: string | null
  amount: number
  settled: number
  outstanding: number
  status: 'open' | 'partial' | 'settled'
  settledOn: string | null
  /** The notice PDF, once the fund has published it. */
  documentId: string | null
  documentViewedAt: string | null
  /** The LP's own acknowledgment, if they made one. */
  ack: { at: string; wiredOn: string | null; reference: string | null; note: string | null } | null
  /** The receipts filed against this line, newest first. */
  receipts: { documentId: string; title: string; date: string | null }[]
  currency: string
}

/**
 * LP portal — every capital call and distribution line for the signed-in LP's entities, with
 * its status from the fund's books, the notice document once published, and their own
 * acknowledgment. Scoped strictly to the investors resolveLpAccess grants, for funds whose
 * portal is on.
 */
export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds, lpAccountId } = access
  if (investorIds.length === 0) return NextResponse.json({ notices: [] })

  const { data: entities } = await (admin as any)
    .from('lp_entities').select('id, fund_id, investor_id').in('investor_id', investorIds)
  const entityRows = ((entities ?? []) as any[])
  const entityIds = new Set(entityRows.map(e => e.id as string))
  const fundIds = Array.from(new Set(entityRows.map(e => e.fund_id as string)))
  if (entityIds.size === 0) return NextResponse.json({ notices: [] })

  const { data: settings } = await (admin as any)
    .from('fund_settings').select('fund_id, lp_portal_enabled, currency').in('fund_id', fundIds)
  const enabled = new Map<string, string>()
  for (const s of ((settings ?? []) as any[])) if (s.lp_portal_enabled) enabled.set(s.fund_id, s.currency ?? 'USD')
  if (enabled.size === 0) return NextResponse.json({ notices: [] })

  // Which vehicles carry lines for these entities — one register read per vehicle, through the
  // same lists the GP sees, so the status is the same number on both sides.
  const [{ data: callLines }, { data: distLines }, { data: vehicles }] = await Promise.all([
    (admin as any).from('capital_call_lines').select('fund_id, vehicle_id').in('lp_entity_id', Array.from(entityIds)),
    (admin as any).from('distribution_lines').select('fund_id, vehicle_id').in('lp_entity_id', Array.from(entityIds)),
    (admin as any).from('fund_vehicles').select('id, fund_id, name').in('fund_id', Array.from(enabled.keys())),
  ])
  const vehicleName = new Map<string, { fundId: string; name: string }>(
    ((vehicles ?? []) as any[]).map(v => [v.id as string, { fundId: v.fund_id as string, name: v.name as string }])
  )
  const targets = new Map<string, { fundId: string; name: string }>()
  for (const r of [...((callLines ?? []) as any[]), ...((distLines ?? []) as any[])]) {
    const v = r.vehicle_id ? vehicleName.get(r.vehicle_id) : undefined
    if (v && enabled.has(v.fundId)) targets.set(r.vehicle_id, v)
  }

  const notices: PortalNotice[] = []
  for (const { fundId, name } of Array.from(targets.values())) {
    const currency = enabled.get(fundId) ?? 'USD'
    const [calls, dists] = await Promise.all([
      listCapitalCalls(admin, fundId, name),
      listDistributions(admin, fundId, name),
    ])
    for (const c of calls) for (const l of c.lines) {
      if (!entityIds.has(l.lpEntityId)) continue
      notices.push({
        kind: 'capital_call', lineId: l.id, fundId, vehicle: name, date: c.callDate, number: c.callNumber,
        description: c.description, dueDate: c.dueDate, amount: l.amount, settled: l.settled, outstanding: l.outstanding,
        status: l.status, settledOn: l.settledOn, documentId: l.noticeDocumentId, documentViewedAt: null, ack: l.ack, receipts: [], currency,
      })
    }
    for (const d of dists) for (const l of d.lines) {
      if (!entityIds.has(l.lpEntityId)) continue
      notices.push({
        kind: 'distribution', lineId: l.id, fundId, vehicle: name, date: d.date, number: null,
        description: l.role === 'carry' ? `${d.description ?? 'Distribution'} — carried interest` : d.description,
        dueDate: null, amount: l.amount, settled: l.settled, outstanding: l.outstanding,
        status: l.status, settledOn: l.settledOn, documentId: l.noticeDocumentId, documentViewedAt: null, ack: null, receipts: [], currency,
      })
    }
  }

  // Receipts: investor-scoped documents in the receipt category, shared with these investors.
  // They are matched to lines by the delivery log, which is the only record of which line a
  // receipt was for.
  const callLineIds = notices.filter(n => n.kind === 'capital_call').map(n => n.lineId)
  if (callLineIds.length > 0) {
    const { data: deliveries } = await (admin as any)
      .from('lp_deliveries').select('item_id, sent_at').eq('kind', 'receipt').eq('status', 'sent').in('item_id', callLineIds)
    const receiptedLines = new Set(((deliveries ?? []) as any[]).map(d => d.item_id as string))
    if (receiptedLines.size > 0) {
      const { data: shares } = await (admin as any)
        .from('lp_document_shares')
        .select('lp_documents(id, title, doc_date, category, fund_id, uploaded_at)')
        .in('lp_investor_id', investorIds)
      const receiptDocs = ((shares ?? []) as any[])
        .map(s => s.lp_documents)
        .filter(d => d && d.category === 'Capital Call Receipt' && enabled.has(d.fund_id))
        .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
      // Without a line id on the document, the best join is title: the receipt title names the
      // call by number and date, which is what the line's card shows too.
      for (const n of notices) {
        if (n.kind !== 'capital_call' || !receiptedLines.has(n.lineId)) continue
        const label = `Capital Call${n.number ? ` No. ${n.number}` : ''} — ${n.date}`
        n.receipts = receiptDocs.filter(d => String(d.title).includes(label)).map(d => ({ documentId: d.id, title: d.title, date: d.doc_date ?? null }))
      }
    }
  }

  const docIds = notices.map(n => n.documentId).filter(Boolean) as string[]
  const readState = docIds.length > 0 ? await getSelfReadState(admin, { lpAccountId, targetType: 'document', targetIds: docIds }) : {}
  for (const n of notices) if (n.documentId) n.documentViewedAt = readState[n.documentId] ?? null

  notices.sort((a, b) => b.date.localeCompare(a.date))
  return NextResponse.json({ notices })
}
