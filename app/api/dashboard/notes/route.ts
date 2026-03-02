import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

export async function GET(req: NextRequest) {
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

  const filter = req.nextUrl.searchParams.get('filter')

  let query = admin
    .from('company_notes')
    .select('id, content, user_id, company_id, created_at, updated_at')
    .eq('fund_id', membership.fund_id)
    .order('created_at', { ascending: true })

  if (filter === 'general') {
    query = query.is('company_id', null)
  }

  const { data: notes, error } = await query as {
    data: { id: string; content: string; user_id: string; company_id: string | null; created_at: string; updated_at: string }[] | null
    error: { message: string } | null
  }

  if (error) return dbError(error, 'dashboard-notes')

  // Batch-load display names
  const { data: members } = await admin
    .from('fund_members')
    .select('user_id, display_name')
    .eq('fund_id', membership.fund_id) as { data: { user_id: string; display_name: string | null }[] | null }

  const nameMap: Record<string, string | null> = {}
  for (const m of members ?? []) {
    nameMap[m.user_id] = m.display_name
  }

  // Batch-load company names for tagged notes
  const companyIds = Array.from(new Set((notes ?? []).map(n => n.company_id).filter(Boolean))) as string[]
  const companyNameMap: Record<string, string> = {}
  if (companyIds.length > 0) {
    const { data: companies } = await admin
      .from('companies')
      .select('id, name')
      .in('id', companyIds) as { data: { id: string; name: string }[] | null }
    for (const c of companies ?? []) {
      companyNameMap[c.id] = c.name
    }
  }

  // Look up user emails
  const result = []
  const emailCache: Record<string, string> = {}
  for (const note of notes ?? []) {
    if (!emailCache[note.user_id]) {
      const { data: { user: noteUser } } = await admin.auth.admin.getUserById(note.user_id)
      emailCache[note.user_id] = noteUser?.email ?? 'Unknown'
    }
    result.push({
      id: note.id,
      content: note.content,
      userId: note.user_id,
      userName: nameMap[note.user_id] || null,
      userEmail: emailCache[note.user_id],
      companyId: note.company_id,
      companyName: note.company_id ? companyNameMap[note.company_id] ?? null : null,
      createdAt: note.created_at,
      edited: note.updated_at !== note.created_at,
    })
  }

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, display_name')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { fund_id: string; display_name: string | null } | null }

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const body = await req.json()
  const { content, companyId } = body

  if (!content?.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  }

  // If companyId provided, verify it belongs to this fund
  let companyName: string | null = null
  if (companyId) {
    const { data: company } = await admin
      .from('companies')
      .select('id, name, fund_id')
      .eq('id', companyId)
      .eq('fund_id', membership.fund_id)
      .maybeSingle() as { data: { id: string; name: string; fund_id: string } | null }

    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    companyName = company.name
  }

  const { data: note, error } = await admin
    .from('company_notes')
    .insert({
      company_id: companyId || null,
      fund_id: membership.fund_id,
      user_id: user.id,
      content: content.trim(),
    } as any)
    .select('id, content, user_id, company_id, created_at')
    .single() as { data: { id: string; content: string; user_id: string; company_id: string | null; created_at: string } | null; error: { message: string } | null }

  if (error || !note) return dbError(error ?? { message: 'Failed to create note' }, 'dashboard-notes')

  return NextResponse.json({
    id: note.id,
    content: note.content,
    userId: note.user_id,
    userName: membership.display_name || null,
    userEmail: user.email ?? 'Unknown',
    companyId: note.company_id,
    companyName,
    createdAt: note.created_at,
    edited: false,
  })
}
