import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDropboxCredentials } from '@/lib/dropbox/credentials'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const creds = await getDropboxCredentials(admin, membership.fund_id)
  if (!creds) {
    return NextResponse.json({
      error: 'Dropbox not configured. Add your Dropbox App Key and App Secret in Settings.',
    }, { status: 400 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
  const redirectUri = `${baseUrl}/api/auth/dropbox/callback`

  const state = Buffer.from(JSON.stringify({
    fund_id: membership.fund_id,
  })).toString('base64url')

  const params = new URLSearchParams({
    client_id: creds.appKey,
    redirect_uri: redirectUri,
    response_type: 'code',
    token_access_type: 'offline',
    state,
  })

  return NextResponse.redirect(`https://www.dropbox.com/oauth2/authorize?${params}`)
}
