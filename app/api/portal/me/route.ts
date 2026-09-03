import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Lightweight check for the GP app header: does the signed-in user also have an
 * active LP account? Used to show a "switch to LP portal" link for dual users.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ isLp: false })

  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('lp_accounts')
    .select('status')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  return NextResponse.json({ isLp: data?.status === 'active' })
}
