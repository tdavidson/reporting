import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// lp_relations domain (lib/access/route-domains.ts) — a receipt goes OUT to an LP, like a notice.
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { receiptCandidates, sendReceipts, type NoticeDelivery } from '@/lib/accounting/notices'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST — receipts for the funded lines of a capital call.
//
//   { callId, group?, lineIds?, preview?: boolean,
//     email?: { subject?, message?, delivery: 'link' | 'attachment' | 'both' } }
//
// `preview` lists every line with money against it — how much, when it arrived, when it was
// last receipted, and whether a receipt is due (money arrived after the last one). Without it, a
// receipt is rendered per selected line (default: every line that is due), filed in the
// partner's portal, and emailed when `email` is given.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const callId = String(body?.callId ?? '')
  if (!callId) return NextResponse.json({ error: 'callId is required' }, { status: 400 })

  if (body?.preview === true) {
    const found = await receiptCandidates(admin, gate.fundId, group, callId)
    if ('error' in found) return NextResponse.json({ error: found.error }, { status: found.status })
    return NextResponse.json({ preview: true, ...found })
  }

  const email = body?.email && typeof body.email === 'object'
    ? {
        subject: typeof body.email.subject === 'string' ? body.email.subject : null,
        message: typeof body.email.message === 'string' ? body.email.message : null,
        delivery: (['link', 'attachment', 'both'].includes(body.email.delivery) ? body.email.delivery : 'both') as NoticeDelivery,
      }
    : null
  const result = await sendReceipts(admin, { fundId: gate.fundId, group, userId: user.id }, callId, {
    lineIds: Array.isArray(body?.lineIds) && body.lineIds.length > 0 ? body.lineIds : undefined,
    email,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
