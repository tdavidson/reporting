import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// GET — list all overrides for this fund
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use user-scoped client for membership check (RLS enforces user can only see own memberships)
  const { data: membership } = await (supabase as any)
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { fund_id: string; role: string } | null }

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('lp_associates_overrides' as any)
    .select('*')
    .eq('fund_id', membership.fund_id)
    .order('associates_entity', { ascending: true }) as { data: any[] | null; error: any }

  if (error) return dbError(error, 'lp-associates-overrides')

  return NextResponse.json(data ?? [])
}

// POST — create/upsert an override
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json()
  const { investorEntity, associatesEntity, ownershipPct, carriedInterestPct } = body

  if (!investorEntity?.trim()) return NextResponse.json({ error: 'investorEntity is required' }, { status: 400 })
  if (!associatesEntity?.trim()) return NextResponse.json({ error: 'associatesEntity is required' }, { status: 400 })
  if (investorEntity.trim().length > 500) return NextResponse.json({ error: 'investorEntity too long' }, { status: 400 })
  if (associatesEntity.trim().length > 500) return NextResponse.json({ error: 'associatesEntity too long' }, { status: 400 })
  if (ownershipPct !== undefined && ownershipPct !== null && (typeof ownershipPct !== 'number' || !isFinite(ownershipPct))) return NextResponse.json({ error: 'ownershipPct must be a number' }, { status: 400 })
  if (carriedInterestPct !== undefined && carriedInterestPct !== null && (typeof carriedInterestPct !== 'number' || !isFinite(carriedInterestPct))) return NextResponse.json({ error: 'carriedInterestPct must be a number' }, { status: 400 })

  const { data, error } = await admin
    .from('lp_associates_overrides' as any)
    .upsert({
      fund_id: writeCheck.fundId,
      investor_entity: investorEntity.trim(),
      associates_entity: associatesEntity.trim(),
      ownership_pct: ownershipPct ?? null,
      carried_interest_pct: carriedInterestPct ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'fund_id,investor_entity,associates_entity' })
    .select('*')
    .single() as { data: any; error: any }

  if (error) return dbError(error, 'lp-associates-overrides-create')

  return NextResponse.json(data)
}

// PUT — update an override
export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json()
  const { id, ownershipPct, carriedInterestPct } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (ownershipPct !== undefined) updates.ownership_pct = ownershipPct
  if (carriedInterestPct !== undefined) updates.carried_interest_pct = carriedInterestPct

  const { data, error } = await admin
    .from('lp_associates_overrides' as any)
    .update(updates)
    .eq('id', id)
    .eq('fund_id', writeCheck.fundId)
    .select('*')
    .single() as { data: any; error: any }

  if (error) return dbError(error, 'lp-associates-overrides-update')

  return NextResponse.json(data)
}

// DELETE — remove an override
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await admin
    .from('lp_associates_overrides' as any)
    .delete()
    .eq('id', id)
    .eq('fund_id', writeCheck.fundId)

  if (error) return dbError(error, 'lp-associates-overrides-delete')

  return NextResponse.json({ ok: true })
}
