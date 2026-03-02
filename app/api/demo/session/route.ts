import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  const email = process.env.DEMO_USER_EMAIL
  if (!email) {
    return NextResponse.json({ error: 'Demo not configured' }, { status: 404 })
  }

  const admin = createAdminClient()

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (error || !data?.properties?.hashed_token) {
    console.error('[demo/session] generateLink error:', error)
    return NextResponse.json({ error: 'Failed to generate demo session' }, { status: 500 })
  }

  return NextResponse.json({
    tokenHash: data.properties.hashed_token,
    email,
  })
}
