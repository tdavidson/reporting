import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { count: openReviewCount } = await supabase
    .from('parsing_reviews')
    .select('id', { count: 'exact', head: true })
    .is('resolution', null)

  const { count: needsReviewEmailCount } = await supabase
    .from('inbound_emails')
    .select('id', { count: 'exact', head: true })
    .eq('processing_status', 'needs_review')

  const { data: fund } = await supabase
    .from('funds')
    .select('name, logo_url')
    .limit(1)
    .single() as { data: { name: string; logo_url: string | null } | null }

  // Check if user is admin and count pending join requests
  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle() as { data: { role: string } | null }

  const isViewer = membership?.role === 'viewer'

  let pendingRequestCount = 0
  if (membership?.role === 'admin') {
    const { count } = await supabase
      .from('fund_join_requests' as any)
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    pendingRequestCount = count ?? 0
  }

  const reviewBadge = (openReviewCount ?? 0) + (needsReviewEmailCount ?? 0)
  const fundName = fund?.name ?? 'Portfolio Reporting'
  const fundLogo = fund?.logo_url ?? null

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {isViewer && (
        <div className="bg-blue-500 text-white text-center text-xs py-1.5 px-4 shrink-0">
          Viewing demo &mdash; read only
        </div>
      )}

      <div className="w-full max-w-screen-xl mx-auto flex flex-col flex-1">
        <AppShell
          fundName={fundName}
          fundLogo={fundLogo}
          userEmail={user.email ?? ''}
          reviewBadge={reviewBadge}
          settingsBadge={pendingRequestCount}
        >
          {children}
        </AppShell>
      </div>
    </div>
  )
}
