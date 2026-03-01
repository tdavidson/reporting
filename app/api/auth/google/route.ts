import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGoogleCredentials } from '@/lib/google/credentials'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const creds = await getGoogleCredentials(admin, membership.fund_id)
  if (!creds) {
    return NextResponse.json({
      error: 'Google OAuth not configured. Add your Google Client ID and Client Secret in Settings.',
    }, { status: 400 })
  }

  // Build the redirect URI from the request
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
  const redirectUri = `${baseUrl}/api/auth/google/callback`

  // Pass return_to in state so callback knows where to redirect
  const returnTo = req.nextUrl.searchParams.get('return_to') || '/settings'
  const state = Buffer.from(JSON.stringify({
    fund_id: membership.fund_id,
    return_to: returnTo,
  })).toString('base64url')

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
