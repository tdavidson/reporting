import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  type CompanyRow = {
    id: string; name: string; stage: string | null; status: string
    industry: string[] | null; aliases: string[] | null; tags: string[]
    portfolio_group: string[] | null; contact_email: string[] | null
    metrics: { id: string }[]; inbound_emails: { received_at: string }[]
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id, name, stage, status, industry, aliases, tags, portfolio_group, contact_email, metrics(id), inbound_emails(received_at)')
    .order('name') as { data: CompanyRow[] | null; error: { message: string } | null }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

  const body = await req.json()
  const { name, aliases, tags, stage, industry, notes, overview, founders, why_invested, current_update, contact_email, portfolio_group } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const admin = createAdminClient()

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
