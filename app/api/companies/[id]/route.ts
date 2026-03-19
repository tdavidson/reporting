import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import type { CompanyStatus } from '@/lib/types/database'
import { dbError } from '@/lib/api-error'
import { logActivity } from '@/lib/activity'

const VALID_STATUSES: CompanyStatus[] = ['active', 'exited', 'written-off']

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return dbError(error, 'companies-id')
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const body = await req.json()
  const { name, aliases, tags, stage, industry, notes, status, overview, founders, why_invested, current_update, contact_email, portfolio_group, google_drive_folder_id, google_drive_folder_name, dropbox_folder_path } = body

  if (name !== undefined && !name?.trim()) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify the user has access to this company's fund
  const { data: company } = await admin
    .from('companies')
    .select('fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: membership } = await admin
    .from('fund_members')
    .select('id')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name.trim()
  if (aliases !== undefined) updates.aliases = aliases
  if (tags !== undefined) updates.tags = tags
  if (stage !== undefined) updates.stage = stage?.trim() || null
  if (industry !== undefined) updates.industry = industry
  if (notes !== undefined) updates.notes = notes?.trim() || null
  if (overview !== undefined) updates.overview = overview?.trim() || null
  if (founders !== undefined) updates.founders = founders?.trim() || null
  if (why_invested !== undefined) updates.why_invested = why_invested?.trim() || null
  if (current_update !== undefined) updates.current_update = current_update?.trim() || null
  if (contact_email !== undefined) updates.contact_email = contact_email
  if (portfolio_group !== undefined) updates.portfolio_group = portfolio_group
  if (google_drive_folder_id !== undefined) updates.google_drive_folder_id = google_drive_folder_id || null
  if (google_drive_folder_name !== undefined) updates.google_drive_folder_name = google_drive_folder_name || null
  if (dropbox_folder_path !== undefined) updates.dropbox_folder_path = dropbox_folder_path || null
  if (body.logo_url !== undefined) updates.logo_url = body.logo_url || null
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
    }
    updates.status = status as CompanyStatus
  }

  const { data, error } = await admin
    .from('companies')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return dbError(error, 'companies-id')

  logActivity(admin, company.fund_id, user.id, 'company.update', { companyId: params.id })

  return NextResponse.json(data)
}
