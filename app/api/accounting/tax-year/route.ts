import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { rateLimit } from '@/lib/rate-limit'
import { closeTaxYear, reopenTaxYear, taxYearState } from '@/lib/tax/year-close'

// Closing and reopening a vehicle's tax year — the tax book's own lock.
//
// GET reports where the year stands, including what a close is waiting on. POST closes or
// reopens. Both refusals come back as 409 rather than 400: the request is well formed and the
// year is simply not ready, which is a different thing for a caller to handle.

function taxYearOr400(raw: unknown): number | NextResponse {
  const year = Number(raw)
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return NextResponse.json({ error: 'A four-digit taxYear is required' }, { status: 400 })
  }
  return year
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const taxYear = taxYearOr400(req.nextUrl.searchParams.get('taxYear'))
  if (taxYear instanceof NextResponse) return taxYear

  const state = await taxYearState(admin, gate.fundId, group, taxYear)
  if ('error' in state) return NextResponse.json(state, { status: 400 })
  return NextResponse.json(state)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `tax-year:${user.id}`, limit: 20, windowSeconds: 60 })
  if (limited) return limited

  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group)
  if (group instanceof NextResponse) return group
  const taxYear = taxYearOr400(body?.taxYear)
  if (taxYear instanceof NextResponse) return taxYear

  if (body?.action === 'close') {
    const result = await closeTaxYear(admin, gate.fundId, group, user.id, taxYear)
    if ('error' in result) return NextResponse.json(result, { status: 409 })
    return NextResponse.json(result)
  }

  if (body?.action === 'reopen') {
    const result = await reopenTaxYear(
      admin,
      gate.fundId,
      group,
      user.id,
      taxYear,
      typeof body?.reason === 'string' ? body.reason : '',
    )
    if ('error' in result) return NextResponse.json(result, { status: 409 })
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: "action must be 'close' or 'reopen'" }, { status: 400 })
}
