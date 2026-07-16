import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
// lp_capital domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'

// Fund-level header + footer for the LIVE LP report cards (the snapshot equivalent lives on
// the snapshot row). GET returns them; PUT saves them.

export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { data } = await (admin as any)
    .from('fund_settings').select('lp_report_description, lp_report_footer').eq('fund_id', gate.fundId).maybeSingle()
  return NextResponse.json({
    description: (data as any)?.lp_report_description ?? '',
    footer: (data as any)?.lp_report_footer ?? '',
  })
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, any> = {}
  if ('description' in body) patch.lp_report_description = String(body.description ?? '').slice(0, 5000) || null
  if ('footer' in body) patch.lp_report_footer = String(body.footer ?? '').slice(0, 5000) || null

  const { error } = await (admin as any)
    .from('fund_settings').update(patch).eq('fund_id', gate.fundId)
  if (error) return dbError(error, 'lp-live-settings')
  return NextResponse.json({ ok: true })
}
