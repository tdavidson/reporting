import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { logActivity } from '@/lib/activity'
import { seedDefaultMetrics } from '@/lib/default-metrics'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  type CompanyRow = {
    id: string; name: string; stage: string | null; status: string
    industry: string[] | null; aliases: string[] | null; tags: string[]
    portfolio_group: string[] | null; contact_email: string[] | null
    website: string | null
    metrics: { id: string }[]; inbound_emails: { received_at: string }[]
  }

  const { data, error } = await admin
    .from('companies')
    .select('id, name, stage, status, industry, aliases, tags, portfolio_group, contact_email, website, metrics(id), inbound_emails(received_at)')
    .eq('fund_id', membership.fund_id)
    .order('name') as { data: CompanyRow[] | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies')

  const companies = (data ?? []).map(c => {
    const emails = c.inbound_emails ?? []
    const lastReportAt = emails.length > 0
      ? emails.reduce((max, e) => e.received_at > max ? e.received_at : max, emails[0].received_at)
      : null
    return {
      id: c.id,
      name: c.name,
      stage: c.stage,
      status: c.status,
      industry: c.industry,
      aliases: c.aliases,
      tags: c.tags ?? [],
      portfolioGroup: c.portfolio_group,
      contactEmail: c.contact_email,
      website: c.website,
      metricsCount: c.metrics?.length ?? 0,
      lastReportAt,
    }
  })

  return NextResponse.json(companies)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const body = await req.json()
  const { name, aliases, tags, stage, website, industry, notes, overview, founders, why_invested, current_update, contact_email, portfolio_group } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'No fund found for this user' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('companies')
    .insert({
      fund_id: membership.fund_id,
      name: name.trim(),
      aliases: aliases ?? null,
      tags: tags ?? [],
      stage: stage?.trim() || null,
      website: website?.trim() || null,
      industry: industry ?? null,
      notes: notes?.trim() || null,
      overview: overview?.trim() || null,
      founders: founders?.trim() || null,
      why_invested: why_invested?.trim() || null,
      current_update: current_update?.trim() || null,
      contact_email: contact_email ?? null,
      portfolio_group: portfolio_group ?? null,
      status: 'active',
    })
    .select()
    .single()

  if (error) return dbError(error, 'companies')

  // Seed the 4 default metrics for every new company
  try {
    await seedDefaultMetrics(admin, data.id, membership.fund_id)
  } catch (metricErr) {
    // Non-fatal — company was created successfully; log and move on
    console.error('[seed-default-metrics] failed for company', data.id, metricErr)
  }

  logActivity(admin, membership.fund_id, user.id, 'company.create', { companyName: name.trim() })

  return NextResponse.json(data, { status: 201 })
}
