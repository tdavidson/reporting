import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
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

  // Create user via Supabase admin API
  const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const { data, error } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: false,
    user_metadata: {
      accepted_license_at: new Date().toISOString(),
    },
  })

  if (error) {
    // Don't reveal whether the email exists — use a generic message
    if (error.message?.includes('already been registered') || error.message?.includes('already exists')) {
      return NextResponse.json({
        error: 'Unable to create account. The email may already be registered.',
      }, { status: 400 })
    }
    return NextResponse.json({ error: 'Unable to create account. Please try again.' }, { status: 500 })
  }

  // Send signup confirmation email via Supabase's auth email system (uses configured SMTP)
  if (data.user) {
    const { error: resendError } = await admin.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
      },
    })
    if (resendError) {
      console.error('[signup] Failed to send confirmation email:', resendError.message)
    }
  }

  return NextResponse.json({ ok: true })
}
