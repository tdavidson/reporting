import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const { data, error } = await admin
    .from('lp_letters')
    .select('id, period_year, period_quarter, period_label, portfolio_group, status, is_year_end, created_at, updated_at')
    .eq('fund_id', membership.fund_id)
    .order('period_year', { ascending: false })
    .order('period_quarter', { ascending: false })

  if (error) return dbError(error, 'lp-letters')
  return NextResponse.json({ letters: data ?? [], role: membership.role })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { period_year, period_quarter, is_year_end, portfolio_group, template_id, generation_prompt } = body

  if (!period_year || !period_quarter || !portfolio_group) {
    return NextResponse.json({ error: 'period_year, period_quarter, and portfolio_group are required' }, { status: 400 })
  }

  const periodLabel = is_year_end
    ? `Q${period_quarter} ${period_year} / Year End ${period_year}`
    : `Q${period_quarter} ${period_year}`

  const { data, error } = await admin
    .from('lp_letters')
    .insert({
      fund_id: fundId,
      template_id: template_id ?? null,
      period_year,
      period_quarter,
      is_year_end: is_year_end ?? false,
      period_label: periodLabel,
      portfolio_group,
      generation_prompt: generation_prompt ?? null,
      status: 'draft',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return dbError(error, 'lp-letters')
  return NextResponse.json(data, { status: 201 })
}
