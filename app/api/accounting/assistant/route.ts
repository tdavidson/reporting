import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; this resolves identity and keeps the demo out of writes.
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { applyProposal } from '@/lib/accounting/assistant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST { action: 'apply', proposal } → apply one proposal as a DRAFT entry.
//
// This is the apply half of the accounting assistant. The ask half moved to /api/analyst, which
// is the one Analyst for the whole app (see docs/plan-unified-analyst.md); it drafts the
// proposals and this route applies them. Applying stays here, behind the accounting domain's
// write grant (enforced by the middleware): the Analyst route never writes to the books.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  if (body?.action !== 'apply') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (!body?.proposal) return NextResponse.json({ error: 'proposal is required' }, { status: 400 })

  const result = await applyProposal(admin, gate.fundId, group, user.id, body.proposal)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...result })
}
