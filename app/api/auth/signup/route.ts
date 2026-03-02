import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email?.trim()) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
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
    .or(`email_pattern.eq.${normalizedEmail},email_pattern.eq.*@${domain}`)
    .limit(1)
    .maybeSingle()

  if (!allowed) {
    return NextResponse.json({
      error: 'This email is not authorized to create an account. Contact your fund administrator.',
    }, { status: 403 })
  }

  // Create user via Supabase admin API
  const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const { data, error } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: false,
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

  // Send confirmation email
  if (data.user) {
    await admin.auth.admin.generateLink({
      type: 'signup',
      email: normalizedEmail,
      password,
      options: {
        redirectTo: `${origin}/auth/callback`,
      },
    })
  }

  return NextResponse.json({ ok: true })
}
