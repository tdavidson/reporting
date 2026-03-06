import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const limited = await rateLimit({ key: `signup:${getClientIp(req)}`, limit: 5, windowSeconds: 300 })
  if (limited) return limited

  const { email, password, acceptedLicense } = await req.json()

  if (!email?.trim()) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }
  if (!acceptedLicense) {
    return NextResponse.json({ error: 'You must accept the license agreement.' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const domain = normalizedEmail.split('@')[1]
  if (!domain) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Server-side whitelist check
  const { data: allowed } = await admin
    .from('allowed_signups')
    .select('id')
    .in('email_pattern', [normalizedEmail, `*@${domain}`])
    .limit(1)
    .maybeSingle()

  if (!allowed) {
    return NextResponse.json({
      error: 'not_whitelisted',
    }, { status: 403 })
  }

  // Whitelist passed — tell the client to proceed with signUp
  return NextResponse.json({ ok: true })
}
