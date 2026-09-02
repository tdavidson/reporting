import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { testDeepgramConnection } from '@/lib/transcription/deepgram'

/**
 * Admin connection test for call transcription. Verifies the Deepgram API key works and reports
 * whether a callback base URL is resolvable — lets an admin confirm transcription is set up
 * without uploading a file.
 */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  // Open to any fund member, consistent with the rest of diligence settings.
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const deepgram = await testDeepgramConnection()

  // The webhook needs a resolvable base URL or Deepgram callbacks have nowhere to land. There is
  // no shared secret to check any more: each job mints its own callback token (SEC-010), so the
  // credential is per-transcription and cannot be misconfigured independently of the job.
  const webhookUrlResolvable = !!(
    process.env.TRANSCRIPTION_WEBHOOK_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL
  )

  return NextResponse.json({
    deepgram,
    webhook_url_resolvable: webhookUrlResolvable,
    ready: deepgram.ok && webhookUrlResolvable,
  })
}
