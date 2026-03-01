import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/app-shell'
import { DemoSeeder } from './demo-seeder'

const isDemo = process.env.DEMO_MODE === 'true'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { count: openReviewCount } = await supabase
    .from('parsing_reviews')
    .select('id', { count: 'exact', head: true })
    .is('resolution', null)

  const { data: fund } = await supabase
    .from('funds')
    .select('name, logo_url')
    .limit(1)
    .single() as { data: { name: string; logo_url: string | null } | null }

  const reviewBadge = openReviewCount ?? 0
  const fundName = fund?.name ?? 'Portfolio Reporting'
  const fundLogo = fund?.logo_url ?? null

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {isDemo && (
        <div className="bg-amber-500 text-white text-center text-xs py-1.5 px-4 shrink-0">
          Running in demo mode — email parsing is disabled
        </div>
      )}

      <div className="w-full max-w-screen-xl mx-auto flex flex-col flex-1">
        <AppShell
          fundName={fundName}
          fundLogo={fundLogo}
          userEmail={user.email ?? ''}
          reviewBadge={reviewBadge}
        >
          {children}
        </AppShell>
      </div>

      {isDemo && <DemoSeeder />}
    </div>
  )
}
