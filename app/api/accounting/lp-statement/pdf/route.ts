import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { generateLpStatementPdf } from '@/lib/accounting/lp-statement-pdf'
import { resolvePeriod, customPeriod, type PeriodPreset } from '@/lib/accounting/statement-period'

export const runtime = 'nodejs'
export const maxDuration = 120

// GET ?lp=<lpEntityId>&preset=|start=&end= — render one partner's capital account
// statement and stream it back. GP-side PREVIEW only: nothing is stored and nothing
// is shared. Publishing (which freezes and delivers it) is the POST /publish route.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const sp = req.nextUrl.searchParams
  const group = await resolveGroupOr400(admin, gate.fundId, sp.get('group'))
  if (group instanceof NextResponse) return group

  const lp = sp.get('lp')
  if (!lp) return NextResponse.json({ error: 'lp is required' }, { status: 400 })

  const preset = sp.get('preset') as PeriodPreset | null
  const period = preset && preset !== 'custom'
    ? resolvePeriod(preset)
    : customPeriod(sp.get('start'), sp.get('end'))

  const result = await generateLpStatementPdf(admin, { fundId: gate.fundId, group, lpEntityId: lp, period })
  if (!result) return NextResponse.json({ error: 'Could not build the statement for that partner' }, { status: 404 })

  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${result.fileName}"`,
    },
  })
}
