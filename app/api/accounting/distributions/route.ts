import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// lp_capital domain (lib/access/route-domains.ts) — this is per-partner capital data, gated
// exactly like capital calls, its inbound mirror.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { proRataDistribution, declareDistribution, listDistributions } from '@/lib/accounting/distributions'

// GET — declared distributions for the vehicle, newest first.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  return NextResponse.json(await listDistributions(admin, gate.fundId, group))
}

// POST — { action: 'preview' | 'declare', … }
//   preview: { total }  → the pro-rata split by capital balance, writing nothing
//   declare: { distributionDate, description?, lines: [{ lpEntityId, amount }] }
//            → Dr each partner's capital, Cr 2300 Distributions payable
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  if (body?.action === 'preview') {
    const total = Number(body?.total)
    if (!Number.isFinite(total) || total <= 0) return NextResponse.json({ error: 'A positive total is required' }, { status: 400 })
    return NextResponse.json({ lines: await proRataDistribution(admin, gate.fundId, group, total) })
  }

  if (body?.action === 'declare') {
    // Character is optional: omitting it leaves the distribution uncharacterised, which is a
    // legitimate state and the one every pre-existing row is in. Supplying a partial split is
    // not — declareDistribution refuses anything that doesn't sum to the declared total.
    const c = body?.character
    const result = await declareDistribution(admin, gate.fundId, group, user.id, {
      distributionDate: String(body?.distributionDate ?? ''),
      description: body?.description ?? null,
      lines: Array.isArray(body?.lines) ? body.lines : [],
      kind: body?.kind,
      character: c
        ? {
            returnOfCapital: Number(c.returnOfCapital ?? 0),
            realizedGain: Number(c.realizedGain ?? 0),
            income: Number(c.income ?? 0),
          }
        : undefined,
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: "action must be 'preview' or 'declare'" }, { status: 400 })
}
