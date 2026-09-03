import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { dbError } from '@/lib/api-error'

// Bulk upsert applicability settings
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `compliance-settings:${user.id}`, limit: 30, windowSeconds: 60 })
  if (limited) return limited

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { settings } = body as {
    settings: { compliance_item_id: string; applies: string; dismissed: boolean; dismissed_reason?: string; portfolio_group?: string }[]
  }

  if (!Array.isArray(settings) || settings.length === 0 || settings.length > 100) {
    return NextResponse.json({ error: 'settings array required (1-100 items)' }, { status: 400 })
  }

  const VALID_APPLIES = ['yes', 'no', 'unsure']

  const rows = settings.map(s => ({
    fund_id: fundId,
    compliance_item_id: String(s.compliance_item_id).slice(0, 100),
    portfolio_group: s.portfolio_group ? String(s.portfolio_group).slice(0, 200) : '',
    applies: VALID_APPLIES.includes(s.applies) ? s.applies : 'unsure',
    dismissed: !!s.dismissed,
    dismissed_reason: s.dismissed_reason ? String(s.dismissed_reason).slice(0, 500) : null,
    dismissed_by: s.dismissed ? user.id : null,
    dismissed_at: s.dismissed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }))

  const { data, error } = await admin
    .from('compliance_fund_settings')
    .upsert(rows, { onConflict: 'fund_id,compliance_item_id,portfolio_group' })
    .select()

  if (error) return dbError(error, 'compliance-settings')
  return NextResponse.json(data)
}

// Update a single item's setting
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `compliance-settings:${user.id}`, limit: 30, windowSeconds: 60 })
  if (limited) return limited

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { compliance_item_id, applies, dismissed, dismissed_reason, completed, completed_note, completed_link, notes, portfolio_group } = body

  if (!compliance_item_id) {
    return NextResponse.json({ error: 'compliance_item_id required' }, { status: 400 })
  }

  const VALID_APPLIES = ['yes', 'no', 'unsure']

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (applies !== undefined) {
    updates.applies = VALID_APPLIES.includes(applies) ? applies : 'unsure'
  }
  if (dismissed !== undefined) {
    updates.dismissed = !!dismissed
    updates.dismissed_by = dismissed ? user.id : null
    updates.dismissed_at = dismissed ? new Date().toISOString() : null
    updates.dismissed_reason = dismissed_reason ? String(dismissed_reason).slice(0, 500) : null
    // Clear completed when dismissing
    if (dismissed) {
      updates.completed = false
      updates.completed_at = null
      updates.completed_by = null
      updates.completed_note = null
      updates.completed_link = null
    }
  }
  if (completed !== undefined) {
    updates.completed = !!completed
    updates.completed_by = completed ? user.id : null
    updates.completed_at = completed ? new Date().toISOString() : null
    updates.completed_note = completed_note ? String(completed_note).slice(0, 2000) : null
    updates.completed_link = completed_link ? String(completed_link).slice(0, 2000) : null
    // Clear dismissed when completing
    if (completed) {
      updates.dismissed = false
      updates.dismissed_by = null
      updates.dismissed_at = null
      updates.dismissed_reason = null
    }
  }
  // Allow updating completed_note/link without toggling completed status
  if (completed_note !== undefined && completed === undefined) {
    updates.completed_note = completed_note ? String(completed_note).slice(0, 2000) : null
  }
  if (completed_link !== undefined && completed === undefined) {
    updates.completed_link = completed_link ? String(completed_link).slice(0, 2000) : null
  }
  if (notes !== undefined) {
    updates.notes = notes ? String(notes).slice(0, 2000) : null
  }

  const { data, error } = await admin
    .from('compliance_fund_settings')
    .upsert({
      fund_id: fundId,
      compliance_item_id,
      portfolio_group: portfolio_group ? String(portfolio_group).slice(0, 200) : '',
      ...updates,
    }, { onConflict: 'fund_id,compliance_item_id,portfolio_group' })
    .select()
    .single()

  if (error) return dbError(error, 'compliance-settings')
  return NextResponse.json(data)
}
