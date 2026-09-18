import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { loadReminderSettings } from '@/lib/reminders/load'
import { fundAdminEmails } from '@/lib/reminders/run'
import { parseRecipients } from '@/lib/reminders/settings'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  let s: Awaited<ReturnType<typeof loadReminderSettings>>, adminEmails: string[]
  try {
    ;[s, adminEmails] = await Promise.all([
      loadReminderSettings(admin, gate.fundId),
      fundAdminEmails(admin, gate.fundId),
    ])
  } catch (err) {
    return dbError(err as Error, 'reminders-settings')
  }
  return NextResponse.json({
    enabled: s.enabled,
    recipients: s.recipients,
    asksSendOffsetDays: s.asksSendOffsetDays,
    adminEmails,
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  if (body.enabled !== undefined) updates.reminders_enabled = !!body.enabled
  if (body.recipients !== undefined) {
    const parsed = parseRecipients(String(body.recipients ?? ''))
    if ('invalid' in parsed) return NextResponse.json({ error: `Invalid recipient: ${parsed.invalid}` }, { status: 400 })
    updates.reminder_recipients = parsed.value
  }
  if (body.asksSendOffsetDays !== undefined) {
    const n = Number(body.asksSendOffsetDays)
    if (!Number.isInteger(n) || n < 0 || n > 90) {
      return NextResponse.json({ error: 'Days after quarter end must be 0–90' }, { status: 400 })
    }
    updates.asks_send_offset_days = n
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { error } = await (admin as any).from('fund_settings').update(updates).eq('fund_id', gate.fundId)
  if (error) return dbError(error, 'settings-reminders')
  return NextResponse.json({ ok: true })
}
