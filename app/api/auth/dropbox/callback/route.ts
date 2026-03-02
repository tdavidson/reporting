import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/crypto'
import { getDropboxCredentials } from '@/lib/dropbox/credentials'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/auth', req.url))

  const code = req.nextUrl.searchParams.get('code')
  const stateParam = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL('/settings?dropbox_error=consent_denied', req.url))
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(new URL('/settings?dropbox_error=missing_params', req.url))
  }

  let fundId: string
  try {
    const state = JSON.parse(Buffer.from(stateParam, 'base64url').toString())
    fundId = state.fund_id
  } catch {
    return NextResponse.redirect(new URL('/settings?dropbox_error=invalid_state', req.url))
  }

  // Verify user has access to this fund
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .eq('fund_id', fundId)
    .maybeSingle()

  if (!membership) {
    return NextResponse.redirect(new URL('/settings?dropbox_error=forbidden', req.url))
  }
  if (membership.role !== 'admin') {
    return NextResponse.redirect(new URL('/settings?dropbox_error=forbidden', req.url))
  }

  const creds = await getDropboxCredentials(admin, fundId)
  if (!creds) {
    return NextResponse.redirect(new URL('/settings?dropbox_error=not_configured', req.url))
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
  const redirectUri = `${baseUrl}/api/auth/dropbox/callback`

  const tokenRes = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.appKey,
      client_secret: creds.appSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenRes.ok) {
    console.error('[dropbox-oauth] Token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(new URL('/settings?dropbox_error=token_exchange_failed', req.url))
  }

  const tokens = await tokenRes.json()
  const refreshToken = tokens.refresh_token

  if (!refreshToken) {
    return NextResponse.redirect(new URL('/settings?dropbox_error=no_refresh_token', req.url))
  }

  // Encrypt and store refresh token
  const { data: settings } = await admin
    .from('fund_settings')
    .select('encryption_key_encrypted')
    .eq('fund_id', fundId)
    .single()

  if (!settings?.encryption_key_encrypted) {
    return NextResponse.redirect(new URL('/settings?dropbox_error=no_encryption_key', req.url))
  }

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) {
    return NextResponse.redirect(new URL('/settings?dropbox_error=server_error', req.url))
  }

  const { decrypt } = await import('@/lib/crypto')
  const dek = decrypt(settings.encryption_key_encrypted, kek)
  const encryptedRefreshToken = encrypt(refreshToken, dek)

  await admin
    .from('fund_settings')
    .update({ dropbox_refresh_token_encrypted: encryptedRefreshToken })
    .eq('fund_id', fundId)

  return NextResponse.redirect(new URL('/settings?dropbox_connected=true', req.url))
}
