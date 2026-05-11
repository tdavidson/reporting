import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { seedDemoData } from '@/lib/demo/seed'

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only admins can trigger the seed
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const seeded = await seedDemoData(user.id)

  // The layout caches fund_settings (including feature_visibility) for 5
  // minutes. Bust it so the sidebar picks up Deals/Diligence immediately.
  revalidateTag('fund-settings')
  revalidateTag('fund-data')

  return NextResponse.json({ seeded })
}
