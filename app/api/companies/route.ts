import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('companies')
    .select('id, name, stage, status, sector, aliases, metrics(id), inbound_emails(received_at)')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const companies = (data ?? []).map(c => {
    const emails = (c.inbound_emails as { received_at: string }[] | null) ?? []
    const lastReportAt = emails.length > 0
      ? emails.reduce((max, e) => e.received_at > max ? e.received_at : max, emails[0].received_at)
      : null
    return {
      id: c.id,
      name: c.name,
      stage: c.stage,
      status: c.status,
      sector: c.sector,
      aliases: c.aliases,
      metricsCount: (c.metrics as { id: string }[] | null)?.length ?? 0,
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
  const { name, aliases, stage, sector, notes } = body

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
      stage: stage?.trim() || null,
      sector: sector?.trim() || null,
      notes: notes?.trim() || null,
      status: 'active',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
