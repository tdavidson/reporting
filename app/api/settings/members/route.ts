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
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const fundId = membership.fund_id
  const isAdmin = membership.role === 'admin'

  // Get all members with their emails from auth.users
  const { data: members } = await admin
    .from('fund_members')
    .select('id, user_id, role, created_at')
    .eq('fund_id', fundId)
    .order('created_at')

  // Get emails for members from auth - we need the admin client for this
  const memberList = []
  for (const m of members ?? []) {
    const { data: { user: memberUser } } = await admin.auth.admin.getUserById(m.user_id)
    memberList.push({
      id: m.id,
      userId: m.user_id,
      email: memberUser?.email ?? 'Unknown',
      role: m.role,
      createdAt: m.created_at,
    })
  }

  // Get pending join requests (only if admin)
  let pendingRequests: Array<{
    id: string
    email: string
    createdAt: string | null
  }> = []

  if (isAdmin) {
    const { data: requests } = await admin
      .from('fund_join_requests')
      .select('id, email, created_at')
      .eq('fund_id', fundId)
      .eq('status', 'pending')
      .order('created_at')

    pendingRequests = (requests ?? []).map(r => ({
      id: r.id,
      email: r.email,
      createdAt: r.created_at,
    }))
  }

  return NextResponse.json({
    members: memberList,
    pendingRequests,
    isAdmin,
  })
}
