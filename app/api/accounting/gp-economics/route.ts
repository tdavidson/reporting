import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import {
  loadGpEconomics, gpLinkFor, setOwnershipWeight, setCarryWeight,
  recordCarryPayment, deleteCarryPayment,
} from '@/lib/accounting/gp-economics'

// GP / associate entity economics for the selected vehicle.
//
//   GET    ?group=<associate vehicle>  → ownership %, carry points, carry accrued/paid/unpaid
//   PUT    { lpEntityId, ownershipWeight?, carryWeight? } → set either weight (null clears)
//   POST   { lpEntityId, paidDate, amount, memo? }        → record a carry payment
//   DELETE ?id=<payment id>                               → remove one
//
// Returns 200 with `{ gp: null }` when the selected vehicle is not a GP/associate entity —
// the capital-accounts page asks on every vehicle and simply hides the panel.

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const asOf = req.nextUrl.searchParams.get('asOf') ?? undefined
  const gp = await loadGpEconomics(admin, gate.fundId, group, asOf)
  return NextResponse.json({ gp })
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group)
  if (group instanceof NextResponse) return group

  const link = await gpLinkFor(admin, gate.fundId, group)
  if (!link) return NextResponse.json({ error: `${group} is not a GP/associate entity.` }, { status: 400 })

  const lpEntityId = String(body?.lpEntityId ?? '')
  if (!lpEntityId) return NextResponse.json({ error: 'lpEntityId is required' }, { status: 400 })

  const num = (v: unknown): number | null => {
    if (v === null || v === '' || v === undefined) return null
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw new Error('Weights must be zero or positive.')
    return n
  }

  try {
    if ('ownershipWeight' in body) {
      await setOwnershipWeight(admin, gate.fundId, link.vehicleId, lpEntityId, num(body.ownershipWeight))
    }
    if ('carryWeight' in body) {
      await setCarryWeight(admin, gate.fundId, link.vehicleId, lpEntityId, num(body.carryWeight))
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Save failed' }, { status: 400 })
  }

  return NextResponse.json({ gp: await loadGpEconomics(admin, gate.fundId, group) })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group)
  if (group instanceof NextResponse) return group

  const link = await gpLinkFor(admin, gate.fundId, group)
  if (!link) return NextResponse.json({ error: `${group} is not a GP/associate entity.` }, { status: 400 })

  try {
    await recordCarryPayment(admin, gate.fundId, user.id, {
      vehicleId: link.vehicleId,
      lpEntityId: String(body?.lpEntityId ?? ''),
      paidDate: String(body?.paidDate ?? ''),
      amount: Number(body?.amount),
      memo: body?.memo,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not record the payment' }, { status: 400 })
  }
  return NextResponse.json({ gp: await loadGpEconomics(admin, gate.fundId, group) })
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  try {
    await deleteCarryPayment(admin, gate.fundId, id)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Delete failed' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
