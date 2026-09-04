import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). Fund-level, not per vehicle: the same vendor
// bills every entity of the firm.
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { listVendors, ensureVendor, normalizeVendorName } from '@/lib/accounting/vendors'

// GET — the fund's vendors.
export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  return NextResponse.json({ vendors: await listVendors(admin, gate.fundId) })
}

// POST — create (or find by name) a vendor. Body: { name, is1099Eligible?, tinOnFile?, notes? }
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const name = normalizeVendorName(String(body?.name ?? ''))
  if (!name || name.length > 120) return NextResponse.json({ error: 'A vendor name (up to 120 characters) is required' }, { status: 400 })

  const vendor = await ensureVendor(admin, gate.fundId, name)
  if (!vendor) return NextResponse.json({ error: 'Could not create the vendor' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.is1099Eligible === 'boolean') patch.is_1099_eligible = body.is1099Eligible
  if (typeof body.tinOnFile === 'boolean') patch.tin_on_file = body.tinOnFile
  if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('vendors' as any).update(patch).eq('id', vendor.id).eq('fund_id', gate.fundId)
    if (error) return dbError(error, 'vendors')
  }
  return NextResponse.json({ vendor: { ...vendor, ...(patch.is_1099_eligible !== undefined ? { is1099Eligible: patch.is_1099_eligible } : {}), ...(patch.tin_on_file !== undefined ? { tinOnFile: patch.tin_on_file } : {}) } })
}

// PATCH — update a vendor. Body: { id, name?, is1099Eligible?, tinOnFile?, notes? }
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const name = normalizeVendorName(body.name)
    if (!name || name.length > 120) return NextResponse.json({ error: 'A vendor name (up to 120 characters) is required' }, { status: 400 })
    patch.name = name
  }
  if (typeof body.is1099Eligible === 'boolean') patch.is_1099_eligible = body.is1099Eligible
  if (typeof body.tinOnFile === 'boolean') patch.tin_on_file = body.tinOnFile
  if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await admin.from('vendors' as any).update(patch).eq('id', id).eq('fund_id', gate.fundId).select('id, name, is_1099_eligible, tin_on_file, notes').maybeSingle()
  if (error) return dbError(error, 'vendors')
  if (!data) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  const r = data as any
  return NextResponse.json({ vendor: { id: r.id, name: r.name, is1099Eligible: !!r.is_1099_eligible, tinOnFile: !!r.tin_on_file, notes: r.notes ?? null } })
}
