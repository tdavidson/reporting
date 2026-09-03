import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

async function getLetterWithAuth(admin: ReturnType<typeof createAdminClient>, letterId: string, fundId: string) {
  const { data, error } = await admin
    .from('lp_letters')
    .select('*')
    .eq('id', letterId)
    .eq('fund_id', fundId)
    .maybeSingle()

  if (error) return { data: null, error }
  return { data, error: null }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  const { data, error } = await getLetterWithAuth(admin, params.id, membership.fund_id)
  if (error) return dbError(error, 'lp-letters-id')
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { company_narratives, full_draft, status, generation_prompt, company_prompts } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (company_narratives !== undefined) updates.company_narratives = company_narratives
  if (full_draft !== undefined) updates.full_draft = full_draft
  if (status !== undefined && ['draft', 'generating', 'complete'].includes(status)) updates.status = status
  if (generation_prompt !== undefined) updates.generation_prompt = generation_prompt
  // portfolio_table_html is always derived server-side — not accepted from client
  if (company_prompts !== undefined) updates.company_prompts = company_prompts

  const { data, error } = await admin
    .from('lp_letters')
    .update(updates)
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .select()
    .single()

  if (error) return dbError(error, 'lp-letters-id')
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const { error } = await admin
    .from('lp_letters')
    .delete()
    .eq('id', params.id)
    .eq('fund_id', fundId)

  if (error) return dbError(error, 'lp-letters-id')
  return NextResponse.json({ ok: true })
}
