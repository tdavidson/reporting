import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RawNote {
  id: string
  deal_id: string
  body: string
  author_id: string | null
  created_at: string
  updated_at: string
}

interface EnrichedNote {
  id: string
  body: string
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  createdAt: string
  updatedAt: string
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data, error } = await admin
    .from('diligence_notes')
    .select('id, deal_id, body, author_id, created_at, updated_at')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const notes = (data ?? []) as unknown as RawNote[]
  const enriched = await enrichAuthors(notes, fundId)
  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId, userId } = guard

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const noteBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!noteBody) return NextResponse.json({ error: 'body is required' }, { status: 400 })

  const { data, error } = await admin
    .from('diligence_notes')
    .insert({
      deal_id: params.id,
      fund_id: fundId,
      body: noteBody,
      author_id: userId,
    } as any)
    .select('id, deal_id, body, author_id, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const [enriched] = await enrichAuthors([data as unknown as RawNote], fundId)
  return NextResponse.json(enriched)
}

async function enrichAuthors(notes: RawNote[], fundId: string): Promise<EnrichedNote[]> {
  if (notes.length === 0) return []
  const admin = createAdminClient()

  // Batch-load display names from fund_members.
  const { data: members } = await admin
    .from('fund_members')
    .select('user_id, display_name')
    .eq('fund_id', fundId)
  const nameMap: Record<string, string | null> = {}
  for (const m of (members ?? []) as Array<{ user_id: string; display_name: string | null }>) {
    nameMap[m.user_id] = m.display_name
  }

  // Resolve unique author emails via auth admin (cheap because we cache per id).
  const emailMap: Record<string, string> = {}
  const uniqueAuthors = Array.from(new Set(notes.map(n => n.author_id).filter((x): x is string => !!x)))
  for (const id of uniqueAuthors) {
    if (emailMap[id]) continue
    const { data: { user: u } } = await admin.auth.admin.getUserById(id)
    emailMap[id] = u?.email ?? 'Unknown'
  }

  return notes.map(n => ({
    id: n.id,
    body: n.body,
    authorId: n.author_id,
    authorName: n.author_id ? (nameMap[n.author_id] ?? null) : null,
    authorEmail: n.author_id ? (emailMap[n.author_id] ?? null) : null,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }))
}

async function ensureMember() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  return { admin, fundId: (membership as any).fund_id as string, userId: user.id }
}
