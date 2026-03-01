import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Verify company exists and user has access
  const { data: company } = await supabase
    .from('companies')
    .select('id, fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: notes, error } = await supabase
    .from('company_notes')
    .select('id, content, user_id, created_at, updated_at')
    .eq('company_id', params.id)
    .order('created_at', { ascending: true }) as { data: { id: string; content: string; user_id: string; created_at: string; updated_at: string }[] | null; error: { message: string } | null }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get the fund_id for looking up display names
  const { data: companyRow } = await supabase
    .from('companies')
    .select('fund_id')
    .eq('id', params.id)
    .maybeSingle() as { data: { fund_id: string } | null }

  // Batch-load display names for all note authors in this fund
  const { data: members } = companyRow
    ? await admin.from('fund_members').select('user_id, display_name').eq('fund_id', companyRow.fund_id) as { data: { user_id: string; display_name: string | null }[] | null }
    : { data: null }
  const nameMap: Record<string, string | null> = {}
  for (const m of members ?? []) {
    nameMap[m.user_id] = m.display_name
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
      createdAt: note.created_at,
      edited: note.updated_at !== note.created_at,
    })
  }

  return NextResponse.json(result)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { content } = body

  if (!content?.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  }

  // Get the company's fund_id
  const { data: company } = await supabase
    .from('companies')
    .select('fund_id')
    .eq('id', params.id)
    .maybeSingle() as { data: { fund_id: string } | null }

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: note, error } = await supabase
    .from('company_notes')
    .insert({
      company_id: params.id,
      fund_id: company.fund_id,
      user_id: user.id,
      content: content.trim(),
    } as any)
    .select('id, content, user_id, created_at')
    .single() as { data: { id: string; content: string; user_id: string; created_at: string } | null; error: { message: string } | null }

  if (error || !note) return NextResponse.json({ error: error?.message ?? 'Failed to create note' }, { status: 500 })

  // Look up current user's display name
  const { data: membership } = await admin
    .from('fund_members')
    .select('display_name')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { display_name: string | null } | null }

  return NextResponse.json({
    id: note.id,
    content: note.content,
    userId: note.user_id,
    userName: membership?.display_name || null,
    userEmail: user.email ?? 'Unknown',
    createdAt: note.created_at,
    edited: false,
  })
}
