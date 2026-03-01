import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CompanyStatus } from '@/lib/types/database'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, aliases, tags, stage, industry, notes, status, overview, founders, why_invested, current_update, contact_email, portfolio_group } = body

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
  if (status !== undefined) updates.status = status as CompanyStatus

  const { data, error } = await admin
    .from('companies')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
