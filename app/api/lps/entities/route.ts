import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// ---------------------------------------------------------------------------
// GET — list all entities for this fund
// ---------------------------------------------------------------------------

export async function GET() {
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
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('lp_entities' as any)
    .select('id, entity_name, investor_id')
    .eq('fund_id', membership.fund_id)
    .order('entity_name') as { data: any[] | null; error: any }

  if (error) return dbError(error, 'lp-entities-list')

  return NextResponse.json(data ?? [])
}

// ---------------------------------------------------------------------------
// POST — create/assign an entity to an investor
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json()
  const { investorId, entityName } = body

  if (!investorId) return NextResponse.json({ error: 'investorId is required' }, { status: 400 })
  if (!entityName?.trim()) return NextResponse.json({ error: 'entityName is required' }, { status: 400 })
  if (entityName.trim().length > 500) return NextResponse.json({ error: 'entityName too long (max 500 chars)' }, { status: 400 })

  // Validate investor belongs to this fund
  const { data: investorCheck } = await admin
    .from('lp_investors' as any)
    .select('id')
    .eq('id', investorId)
    .eq('fund_id', writeCheck.fundId)
    .maybeSingle()
  if (!investorCheck) return NextResponse.json({ error: 'Investor not found' }, { status: 404 })

  const { data, error } = await admin
    .from('lp_entities' as any)
    .insert({
      fund_id: writeCheck.fundId,
      investor_id: investorId,
      entity_name: entityName.trim(),
    })
    .select('*')
    .single() as { data: any; error: { message: string } | null }

  if (error) return dbError(error, 'lp-entities-create')

  return NextResponse.json(data)
}

// ---------------------------------------------------------------------------
// PUT — reassign entity to different investor
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json()
  const { id, investorId } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  if (!investorId) return NextResponse.json({ error: 'investorId is required' }, { status: 400 })

  // Validate investor belongs to this fund
  const { data: investorCheck } = await admin
    .from('lp_investors' as any)
    .select('id')
    .eq('id', investorId)
    .eq('fund_id', writeCheck.fundId)
    .maybeSingle()
  if (!investorCheck) return NextResponse.json({ error: 'Investor not found' }, { status: 404 })

  const { data, error } = await admin
    .from('lp_entities' as any)
    .update({ investor_id: investorId })
    .eq('id', id)
    .eq('fund_id', writeCheck.fundId)
    .select('*')
    .single() as { data: any; error: { message: string } | null }

  if (error) return dbError(error, 'lp-entities-update')

  return NextResponse.json(data)
}

// ---------------------------------------------------------------------------
// DELETE — remove an entity by id
// ---------------------------------------------------------------------------

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
    .from('lp_entities' as any)
    .delete()
    .eq('id', id)
    .eq('fund_id', writeCheck.fundId)

  if (error) return dbError(error, 'lp-entities-delete')

  return NextResponse.json({ ok: true })
}
