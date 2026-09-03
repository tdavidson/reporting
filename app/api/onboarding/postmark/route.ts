import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const access = await assertAdminAccess(admin, user.id)
  if (access instanceof NextResponse) return access

  const { fundId, postmarkInboundAddress } = await req.json()
  if (!fundId || !postmarkInboundAddress?.trim()) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (fundId !== access.fundId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await admin
    .from('fund_settings')
    .update({ postmark_inbound_address: postmarkInboundAddress.trim() })
    .eq('fund_id', fundId)

  if (error) {
    return NextResponse.json({ error: 'Failed to save Postmark settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
