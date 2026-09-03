import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const domain = user.email?.split('@')[1]?.toLowerCase()
  if (!domain) return NextResponse.json({ fund: null })

  const admin = createAdminClient()

  // Check if user already belongs to a fund — if so, don't suggest joining
  const { data: existing } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) return NextResponse.json({ fund: null })

  const { data: fund } = await admin
    .from('funds')
    .select('id, name')
    .eq('email_domain', domain)
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ fund: fund ?? null })
}
