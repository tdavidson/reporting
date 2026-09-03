import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { dbError } from '@/lib/api-error'

const URL_RE = /^https?:\/\/.+/i

// GET — list all links for the fund
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const { data, error } = await (admin.from('compliance_links' as any) as any)
    .select('*')
    .eq('fund_id', membership.fund_id)
    .order('created_at', { ascending: true })

  if (error) return dbError(error, 'compliance-links')
  return NextResponse.json(data ?? [])
}

// POST — create a new link
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `compliance-links:${user.id}`, limit: 30, windowSeconds: 60 })
  if (limited) return limited

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { title, description, url, compliance_item_id } = body as {
    title: string
    description?: string
    url: string
    compliance_item_id?: string
  }

  if (!title?.trim() || !url?.trim()) {
    return NextResponse.json({ error: 'Title and URL are required' }, { status: 400 })
  }

  if (!URL_RE.test(url.trim())) {
    return NextResponse.json({ error: 'URL must start with http:// or https://' }, { status: 400 })
  }

  const row = {
    fund_id: fundId,
    title: title.trim().slice(0, 200),
    description: description?.trim()?.slice(0, 500) || null,
    url: url.trim().slice(0, 2000),
    compliance_item_id: compliance_item_id?.trim() || null,
    created_by: user.id,
  }

  const { data, error } = await (admin.from('compliance_links' as any) as any)
    .insert(row)
    .select()
    .single()

  if (error) return dbError(error, 'compliance-links')
  return NextResponse.json(data, { status: 201 })
}

// PATCH — update an existing link
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `compliance-links:${user.id}`, limit: 30, windowSeconds: 60 })
  if (limited) return limited

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { id, title, description, url, compliance_item_id } = body as {
    id: string
    title?: string
    description?: string
    url?: string
    compliance_item_id?: string | null
  }

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (title !== undefined) {
    if (!title.trim()) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    updates.title = title.trim().slice(0, 200)
  }
  if (url !== undefined) {
    if (!url.trim()) return NextResponse.json({ error: 'URL cannot be empty' }, { status: 400 })
    if (!URL_RE.test(url.trim())) return NextResponse.json({ error: 'URL must start with http:// or https://' }, { status: 400 })
    updates.url = url.trim().slice(0, 2000)
  }
  if (description !== undefined) updates.description = description?.trim()?.slice(0, 500) || null
  if (compliance_item_id !== undefined) updates.compliance_item_id = compliance_item_id?.trim() || null

  const { data, error } = await (admin.from('compliance_links' as any) as any)
    .update(updates)
    .eq('id', id)
    .eq('fund_id', fundId)
    .select()
    .single()

  if (error) return dbError(error, 'compliance-links')
  return NextResponse.json(data)
}

// DELETE — remove a link by id
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `compliance-links:${user.id}`, limit: 30, windowSeconds: 60 })
  if (limited) return limited

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await (admin.from('compliance_links' as any) as any)
    .delete()
    .eq('id', id)
    .eq('fund_id', fundId)

  if (error) return dbError(error, 'compliance-links')
  return NextResponse.json({ ok: true })
}
