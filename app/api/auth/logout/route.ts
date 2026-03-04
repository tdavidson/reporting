import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'

export async function POST(req: Request) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const admin = createAdminClient()
    const { data: membership } = await admin
      .from('fund_members')
      .select('fund_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (membership) {
      logActivity(admin, membership.fund_id, user.id, 'logout')
    }
  }

  await supabase.auth.signOut()

  // Use request origin so redirect stays on the same URL (preview, production, etc.)
  const origin = new URL(req.url).origin
  return NextResponse.redirect(new URL('/auth', origin))
}
