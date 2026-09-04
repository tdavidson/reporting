import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess, resolveFund } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { logActivity } from '@/lib/activity'
import { normalizePhoneNumber } from '@/lib/messaging/phone'
import { loadSmsConfig, sendSms } from '@/lib/messaging/sms-config'
import {
  hashVerificationCode,
  mintVerificationCode,
  verificationCodeMatches,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_TTL_MS,
} from '@/lib/messaging/verification'

/**
 * A member's own linked mobile number — the phone half of "Text the Analyst".
 *
 * GET     status: is texting set up for the fund, and where does this member stand
 * POST    { phoneNumber }  start linking: store the number unverified and text it a code
 * PUT     { code }         finish linking: the code came back, so the phone is theirs
 * DELETE                   unlink
 *
 * Personal, not administrative — every member links their own phone — so the route is `any` in
 * the registry and scopes everything by the session user. The fund-level provider configuration
 * (which number, whose Twilio account) is admin-only and lives on /api/settings.
 */

interface PhoneRow {
  id: string
  phone_e164: string
  verified_at: string | null
  verification_code_hash: string | null
  verification_expires_at: string | null
  verification_attempts: number
  opted_out_at: string | null
}

const PHONE_COLUMNS = 'id, phone_e164, verified_at, verification_code_hash, verification_expires_at, verification_attempts, opted_out_at'

async function ownRow(admin: ReturnType<typeof createAdminClient>, fundId: string, userId: string): Promise<PhoneRow | null> {
  const { data, error } = await admin
    .from('analyst_phone_numbers')
    .select(PHONE_COLUMNS)
    .eq('fund_id', fundId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as PhoneRow | null) ?? null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await resolveFund(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const [config, row] = await Promise.all([
    loadSmsConfig(admin, gate.fundId),
    ownRow(admin, gate.fundId, user.id),
  ])
  return NextResponse.json({
    configured: !!config,
    fundNumber: config?.fromNumber ?? null,
    phoneNumber: row?.phone_e164 ?? null,
    verified: !!row?.verified_at,
    pendingVerification: !!row && !row.verified_at && !!row.verification_code_hash,
    optedOut: !!row?.opted_out_at,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  // Each code is a text the fund pays for and a guess window for whoever holds the number.
  const limited = await rateLimit({ key: `sms-verify:${user.id}`, limit: 5, windowSeconds: 3600 })
  if (limited) return limited

  const body = await req.json().catch(() => null) as { phoneNumber?: unknown } | null
  const phoneNumber = typeof body?.phoneNumber === 'string' ? normalizePhoneNumber(body.phoneNumber) : null
  if (!phoneNumber) {
    return NextResponse.json({ error: 'Enter a mobile number, including the country code for numbers outside North America.' }, { status: 400 })
  }

  const config = await loadSmsConfig(admin, gate.fundId)
  if (!config) {
    return NextResponse.json({ error: 'Text messaging is not set up for this fund. An admin can enable it in Settings.' }, { status: 409 })
  }

  // A verified number identifies one person. The partial unique index enforces it; this is the
  // message that explains it.
  const { data: claimed } = await admin
    .from('analyst_phone_numbers')
    .select('user_id')
    .eq('phone_e164', phoneNumber)
    .not('verified_at', 'is', null)
    .neq('user_id', user.id)
    .maybeSingle()
  if (claimed) {
    return NextResponse.json({ error: 'That number is already linked to another account.' }, { status: 409 })
  }

  const code = mintVerificationCode()
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString()

  // Two steps because the hash is bound to the row id. Insert-or-reset, then hash against the id
  // the row actually has.
  const existing = await ownRow(admin, gate.fundId, user.id)
  let rowId: string
  if (existing) {
    rowId = existing.id
  } else {
    const { data: created, error } = await admin
      .from('analyst_phone_numbers')
      .insert({ fund_id: gate.fundId, user_id: user.id, phone_e164: phoneNumber } as never)
      .select('id')
      .single()
    if (error || !created) {
      return NextResponse.json({ error: 'Could not save the number. Try again.' }, { status: 500 })
    }
    rowId = (created as { id: string }).id
  }
  const { error: resetError } = await admin
    .from('analyst_phone_numbers')
    .update({
      phone_e164: phoneNumber,
      verified_at: null,
      verification_code_hash: hashVerificationCode(code, rowId),
      verification_expires_at: expiresAt,
      verification_attempts: 0,
      conversation_id: null,
      opted_out_at: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', rowId)
  if (resetError) return NextResponse.json({ error: 'Could not save the number. Try again.' }, { status: 500 })

  try {
    await sendSms(config, phoneNumber, `${code} is your verification code for the Analyst. It expires in 10 minutes.`)
  } catch (error) {
    console.error('[settings/phone] verification text failed:', error)
    return NextResponse.json({ error: 'The verification text could not be sent. Check the number, or ask an admin to check the Twilio settings.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, phoneNumber, expiresAt })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => null) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.replace(/\s+/g, '') : ''
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the six-digit code.' }, { status: 400 })

  const row = await ownRow(admin, gate.fundId, user.id)
  if (!row || !row.verification_code_hash) {
    return NextResponse.json({ error: 'No verification in progress. Enter your number to get a new code.' }, { status: 400 })
  }
  if (row.verification_expires_at && new Date(row.verification_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'That code has expired. Request a new one.' }, { status: 410 })
  }
  if (row.verification_attempts >= VERIFICATION_MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'Too many attempts. Request a new code.' }, { status: 429 })
  }

  if (!verificationCodeMatches(code, row.id, row.verification_code_hash)) {
    await admin
      .from('analyst_phone_numbers')
      .update({ verification_attempts: row.verification_attempts + 1 } as never)
      .eq('id', row.id)
    return NextResponse.json({ error: 'That code is not right.' }, { status: 400 })
  }

  const { error } = await admin
    .from('analyst_phone_numbers')
    .update({
      verified_at: new Date().toISOString(),
      verification_code_hash: null,
      verification_expires_at: null,
      verification_attempts: 0,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', row.id)
  if (error) {
    // 23505: someone else verified this number between the check in POST and now.
    const status = (error as { code?: string }).code === '23505' ? 409 : 500
    return NextResponse.json({ error: status === 409 ? 'That number is already linked to another account.' : 'Could not verify. Try again.' }, { status })
  }

  await logActivity(admin, gate.fundId, user.id, 'phone_linked', { phone: row.phone_e164.slice(-4) })

  // Best effort: the link is done whether or not the welcome lands.
  const config = await loadSmsConfig(admin, gate.fundId)
  if (config) {
    sendSms(config, row.phone_e164, 'You\'re linked. Text me a question about your portfolio any time. Reply NEW for a fresh conversation, STOP to opt out.')
      .catch(error => console.error('[settings/phone] welcome text failed:', error))
  }

  return NextResponse.json({ ok: true, verified: true, phoneNumber: row.phone_e164 })
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { error } = await admin
    .from('analyst_phone_numbers')
    .delete()
    .eq('fund_id', gate.fundId)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'Could not unlink the number.' }, { status: 500 })

  await logActivity(admin, gate.fundId, user.id, 'phone_unlinked')
  return NextResponse.json({ ok: true })
}
