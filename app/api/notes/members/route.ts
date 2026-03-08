import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
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

  const { data: members } = await admin
    .from('fund_members')
    .select('user_id, display_name')
    .eq('fund_id', membership.fund_id) as { data: { user_id: string; display_name: string | null }[] | null }

  const result = []
  for (const m of (members ?? []).filter(m => m.user_id !== user.id)) {
    let name = m.display_name?.trim()
    if (!name) {
      const { data: { user: memberUser } } = await admin.auth.admin.getUserById(m.user_id)
      name = memberUser?.email?.split('@')[0]
    }
    if (name) {
      result.push({ userId: m.user_id, displayName: name })
    }
  }

  return NextResponse.json(result)
}
