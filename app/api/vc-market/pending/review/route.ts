import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface ReviewAction {
  id: string
  action: 'approve' | 'reject'
  // optional field overrides when approving
  company_name?: string
  amount_usd?: number | null
  deal_date?: string | null
  stage?: string | null
  investors?: string[]
  segment?: string | null
  country?: string | null
  source_url?: string | null
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { actions }: { actions: ReviewAction[] } = await req.json()
    if (!Array.isArray(actions) || actions.length === 0) {
      return NextResponse.json({ error: 'No actions provided' }, { status: 400 })
    }

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any

    const toApprove = actions.filter(a => a.action === 'approve')
    const toReject  = actions.filter(a => a.action === 'reject')

    let approved = 0
    let rejected = 0

    // Approve: fetch pending rows, merge edits, upsert into vc_deals
    if (toApprove.length > 0) {
      const ids = toApprove.map(a => a.id)
      const { data: rows } = await db
        .from('vc_deals_pending')
        .select('*')
        .in('id', ids)
        .eq('user_id', user.id)

      if (rows && rows.length > 0) {
        const toInsert = rows.map((row: Record<string, unknown>) => {
          const override = toApprove.find(a => a.id === row.id) ?? {}
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, status, created_at, ...base } = row as Record<string, unknown>
          return {
            ...base,
            ...(override.company_name !== undefined && { company_name: override.company_name }),
            ...(override.amount_usd   !== undefined && { amount_usd:   override.amount_usd }),
            ...(override.deal_date    !== undefined && { deal_date:    override.deal_date }),
            ...(override.stage        !== undefined && { stage:        override.stage }),
            ...(override.investors    !== undefined && { investors:    override.investors }),
            ...(override.segment      !== undefined && { segment:      override.segment }),
            ...(override.country      !== undefined && { country:      override.country }),
            ...(override.source_url   !== undefined && { source_url:   override.source_url }),
          }
        })

        const { data: inserted, error: insertErr } = await db
          .from('vc_deals')
          .upsert(toInsert, { onConflict: 'user_id,company_name,deal_date', ignoreDuplicates: true })
          .select('id')

        if (insertErr) throw insertErr
        approved = inserted?.length ?? toInsert.length
      }

      // Mark as approved in staging
      await db.from('vc_deals_pending').update({ status: 'approved' }).in('id', ids).eq('user_id', user.id)
    }

    // Reject: just mark as rejected
    if (toReject.length > 0) {
      const ids = toReject.map(a => a.id)
      await db.from('vc_deals_pending').update({ status: 'rejected' }).in('id', ids).eq('user_id', user.id)
      rejected = toReject.length
    }

    return NextResponse.json({ approved, rejected })
  } catch (err) {
    console.error('[vc-market/pending/review]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
