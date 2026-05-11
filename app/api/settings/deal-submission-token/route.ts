import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Generate or clear the public-submission token for a fund. The token is the
 * sole authorization for the public /submit/<token> form, so generating a new
 * one immediately invalidates the old URL.
 */

export async function POST(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if ((membership as any).role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  // 32 bytes → 43-char base64url token. Long enough that brute force is hopeless
  // and the URL is still pasteable.
  const token = crypto.randomBytes(32).toString('base64url')

  const { error } = await admin
    .from('fund_settings')
    .update({ deal_submission_token: token })
    .eq('fund_id', membership.fund_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ token })
}

export async function DELETE(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if ((membership as any).role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const { error } = await admin
    .from('fund_settings')
    .update({ deal_submission_token: null })
    .eq('fund_id', membership.fund_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
