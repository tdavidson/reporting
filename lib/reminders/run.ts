// One fund's daily pass: load → collect → diff against reminder_deliveries → send one digest →
// log the new keys. A failed send logs nothing, so tomorrow retries; a failed log after a
// successful send risks one duplicate digest, which is the acceptable direction to fail.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOutboundConfig, sendOutboundEmail } from '@/lib/email'
import { collectReminders } from './collect'
import { isoDate } from './dates'
import { renderDigest, undeliveredKeys } from './digest'
import { loadFundReminderData, loadReminderSettings } from './load'

export interface FundRunResult {
  fundId: string
  items: number
  newKeys: number
  sent: boolean
  error?: string
}

export async function fundAdminEmails(admin: SupabaseClient, fundId: string): Promise<string[]> {
  const { data: admins } = await admin.from('fund_members').select('user_id').eq('fund_id', fundId).eq('role', 'admin')
  const ids = new Set(((admins ?? []) as { user_id: string }[]).map(a => a.user_id))
  if (ids.size === 0) return []
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  return (data?.users ?? []).filter(u => u.email && ids.has(u.id)).map(u => u.email!)
}

async function deliveredKeys(admin: SupabaseClient, fundId: string, keys: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await (admin as any).from('reminder_deliveries')
      .select('key').eq('fund_id', fundId).in('key', keys.slice(i, i + 200))
    for (const r of (data ?? []) as { key: string }[]) out.add(r.key)
  }
  return out
}

/**
 * `test: true` (the Settings "send test digest" button) sends whatever is open today regardless
 * of the delivery log, prefixes the subject, and logs nothing — so testing never swallows a real
 * reminder.
 */
export async function runFundReminders(
  admin: SupabaseClient,
  fundId: string,
  opts: { now?: Date; test?: boolean } = {},
): Promise<FundRunResult> {
  const today = isoDate(opts.now ?? new Date())
  const settings = await loadReminderSettings(admin, fundId)
  const data = await loadFundReminderData(admin, fundId, today, settings.asksSendOffsetDays)
  const items = collectReminders(data, today)
  const result: FundRunResult = { fundId, items: items.length, newKeys: 0, sent: false }
  if (items.length === 0) return result

  const allKeys = [...new Set(items.flatMap(i => i.keys))]
  const fresh = undeliveredKeys(items, await deliveredKeys(admin, fundId, allKeys))
  result.newKeys = fresh.length
  if (!opts.test && fresh.length === 0) return result

  const recipients = settings.recipients.length ? settings.recipients : await fundAdminEmails(admin, fundId)
  if (recipients.length === 0) return { ...result, error: 'no recipients' }

  const config = await getOutboundConfig(admin, fundId, 'system')
  if (!config) return { ...result, error: 'no outbound email provider configured' }

  const { subject, html } = renderDigest(items, {
    fundName: settings.fundName,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
    today,
  })

  try {
    await sendOutboundEmail(config, { to: recipients.join(', '), subject: opts.test ? `[Test] ${subject}` : subject, html })
  } catch (err) {
    return { ...result, error: err instanceof Error ? err.message : 'send failed' }
  }
  result.sent = true

  if (!opts.test && fresh.length > 0) {
    const { error } = await (admin as any).from('reminder_deliveries')
      .upsert(fresh.map(key => ({ fund_id: fundId, key })), { onConflict: 'fund_id,key', ignoreDuplicates: true })
    if (error) result.error = `sent, but logging failed: ${error.message}`
  }
  return result
}
