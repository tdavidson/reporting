import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'

interface Sender {
  email: string
  label: string
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const access = await assertAdminAccess(admin, user.id)
  if (access instanceof NextResponse) return access

  const { fundId, senders } = await req.json() as { fundId: string; senders: Sender[] }

  if (!fundId || !Array.isArray(senders) || senders.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (fundId !== access.fundId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = senders
    .filter(s => s.email?.trim())
    .map(s => ({
      fund_id: fundId,
      email: s.email.trim().toLowerCase(),
      label: s.label?.trim() || null,
    }))

  const { error } = await admin
    .from('authorized_senders')
    .upsert(rows, { onConflict: 'fund_id,email' })

  if (error) {
    return NextResponse.json({ error: 'Failed to save senders' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
