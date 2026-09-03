import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { assertAdminAccess } from '@/lib/api-helpers'
import {
  createGoogleOAuthTransaction,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_TTL_SECONDS,
} from '@/lib/google/oauth-state'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const access = await assertAdminAccess(admin, user.id)
  if (access instanceof NextResponse) return access

  const creds = await getGoogleCredentials(admin, access.fundId)
  if (!creds) {
    return NextResponse.json({
      error: 'Google OAuth not configured. Add your Google Client ID and Client Secret in Settings.',
    }, { status: 400 })
  }

  // Build the redirect URI. Google's OAuth requires HTTPS in production; if
  // NEXT_PUBLIC_APP_URL was misconfigured as http://, upgrade it. Trailing
  // slashes are stripped so the redirect URI matches what's registered.
  let baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
  baseUrl = baseUrl.replace(/\/$/, '')
  if (baseUrl.startsWith('http://') && !baseUrl.startsWith('http://localhost')) {
    baseUrl = baseUrl.replace(/^http:\/\//, 'https://')
  }
  const redirectUri = `${baseUrl}/api/auth/google/callback`

  // Keep navigation state out of the authorization URL. The callback recovers it from the
  // encrypted, HttpOnly transaction cookie after validating the one-time nonce and current user.
  const rawReturnTo = req.nextUrl.searchParams.get('return_to') ?? ''
  const returnTo = rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
    ? rawReturnTo.slice(0, 200)
    : '/settings'
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey) {
    return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })
  }
  const transaction = createGoogleOAuthTransaction({
    encryptionKey,
    fundId: access.fundId,
    returnTo,
    userId: user.id,
  })

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // drive.readonly lets the app read any file the user can access in Drive
    // — required for "import a folder by URL" to read the contents of files
    // the user didn't explicitly pick via Google Picker. drive.file alone
    // returns 403 on direct API calls to files the app didn't create.
    // drive.file is also kept so files uploaded TO Drive by the app (e.g.
    // rendered memo Google Docs) stay tracked as app-owned.
    // gmail.send permits outbound email send for asks/letters.
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    // `consent` forces the consent screen so refresh tokens are re-issued
    // even if the user previously authorized. `select_account` forces the
    // account picker first, useful when the browser has multiple Google
    // sessions and the default isn't the one that should own the connection.
    prompt: 'consent select_account',
    state: transaction.state,
    code_challenge: transaction.codeChallenge,
    code_challenge_method: 'S256',
  })

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, transaction.cookie, {
    httpOnly: true,
    maxAge: GOOGLE_OAUTH_STATE_TTL_SECONDS,
    path: '/api/auth/google/callback',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
