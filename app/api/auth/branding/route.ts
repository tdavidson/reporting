import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const admin = createAdminClient()

  const { data: fund } = await admin
    .from('funds')
    .select('id, name, logo_url')
    .limit(1)
    .maybeSingle()

  let authSubtitle: string | null = null
  let authContact: string | null = null

  if (fund) {
    const { data: settings } = await admin
      .from('fund_settings')
      .select('auth_subtitle, auth_contact')
      .eq('fund_id', fund.id)
      .maybeSingle()

    authSubtitle = settings?.auth_subtitle ?? null
    authContact = settings?.auth_contact ?? null
  }

  return NextResponse.json({
    fundName: fund?.name || null,
    fundLogo: fund?.logo_url || null,
    authSubtitle,
    authContact,
  })
}
