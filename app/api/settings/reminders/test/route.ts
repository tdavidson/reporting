import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { runFundReminders } from '@/lib/reminders/run'

/** Send today's digest now, ignoring the delivery log and logging nothing. */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `reminders-test:${user.id}`, limit: 5, windowSeconds: 300 })
  if (limited) return limited

  const admin = createAdminClient()
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  return NextResponse.json(await runFundReminders(admin, gate.fundId, { test: true }))
}
