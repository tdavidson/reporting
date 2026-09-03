import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { folder_id, folder_name } = await req.json()

  if (!folder_id || !folder_name) {
    return NextResponse.json({ error: 'folder_id and folder_name are required' }, { status: 400 })
  }

  const { error } = await admin
    .from('fund_settings')
    .update({
      google_drive_folder_id: folder_id,
      google_drive_folder_name: folder_name,
    })
    .eq('fund_id', membership.fund_id)

  if (error) return dbError(error, 'settings-drive')

  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { error } = await admin
    .from('fund_settings')
    .update({
      google_refresh_token_encrypted: null,
      google_drive_folder_id: null,
      google_drive_folder_name: null,
    })
    .eq('fund_id', membership.fund_id)

  if (error) return dbError(error, 'settings-drive')

  return NextResponse.json({ ok: true })
}
