import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { SubmitForm } from './submit-form'

export const metadata: Metadata = { title: 'Submit a pitch' }

export default async function SubmitPage({ params }: { params: { token: string } }) {
  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('fund_settings')
    .select('fund_id, deal_intake_enabled, deal_submission_token')
    .eq('deal_submission_token', params.token)
    .maybeSingle()

  if (!settings || !(settings as any).deal_intake_enabled) notFound()

  const { data: fund } = await admin
    .from('funds')
    .select('name, logo_url')
    .eq('id', (settings as any).fund_id)
    .maybeSingle()

  const fundName = (fund as any)?.name ?? 'this fund'
  const fundLogo = (fund as any)?.logo_url ?? null

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          {fundLogo && <img src={fundLogo} alt={fundName} className="h-12 mx-auto mb-4" />}
          <h1 className="text-2xl font-semibold tracking-tight">Submit a pitch to {fundName}</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Tell us what you're building. We'll review and get back to you. Required fields are marked.
          </p>
        </div>
        <SubmitForm token={params.token} fundName={fundName} />
      </div>
    </div>
  )
}
