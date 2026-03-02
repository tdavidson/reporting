import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// GET — list all whitelisted email patterns (admin only)
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { data: entries } = await admin
    .from('allowed_signups')
    .select('id, email_pattern, created_at')
    .order('email_pattern')

  return NextResponse.json({ entries: entries ?? [] })
}

// POST — add a new whitelist entry (admin only)
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { emailPattern } = await req.json()
  if (!emailPattern?.trim()) {
    return NextResponse.json({ error: 'Email pattern is required' }, { status: 400 })
  }

  const pattern = emailPattern.trim().toLowerCase()

  // Validate format: exact email or *@domain.com
  const isExact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pattern)
  const isWildcard = /^\*@[^\s@]+\.[^\s@]+$/.test(pattern)
  if (!isExact && !isWildcard) {
    return NextResponse.json({
      error: 'Must be an email (user@domain.com) or wildcard (*@domain.com)',
    }, { status: 400 })
  }

  const { error } = await admin
    .from('allowed_signups')
    .insert({ email_pattern: pattern })

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This pattern already exists' }, { status: 409 })
    }
    return dbError(error, 'settings-whitelist')
  }

  return NextResponse.json({ ok: true })
}
