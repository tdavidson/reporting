import { getPortalFund } from '@/lib/portal-fund'
import { appleTouchIcons } from '@/lib/pwa'
import { themeCssVars } from '@/lib/theme'
import { PortalChrome } from '@/components/portal-chrome'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordPortalVisit } from '@/lib/lp-access-log'

// `manifest` overrides the app-wide one from app/layout.tsx. Without it an LP
// installing from the portal would get the manager app: launching at /dashboard,
// which the LP/GP split in middleware bounces them straight out of.
//
// This REPLACES the inherited link rather than sitting alongside it — a browser reads
// only the first <link rel="manifest">. The override works only because the root
// manifest is a route handler rather than Next's app/manifest.ts file convention,
// which would win over this field. See app/manifest.webmanifest/route.ts.
export const metadata = {
  title: 'Investor Portal',
  manifest: '/portal/manifest.webmanifest',
  // iOS reads apple-touch-icon ahead of the manifest's icons, so overriding the
  // manifest alone would still have put the manager icon on an LP's home screen.
  // One link per size, for the same reason as the manager app — see app/layout.tsx.
  icons: { apple: appleTouchIcons('portal') },
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const fund = await getPortalFund()
  const themeVars = themeCssVars(fund?.theme ?? null)
  const fundName = fund?.name ?? 'Investor Portal'

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Best-effort login/session tracking (throttled to one event per 30 min).
  if (user && fund?.fundId) {
    await recordPortalVisit(createAdminClient(), { userId: user.id, fundId: fund.fundId })
  }

  return (
    <div className="min-h-screen bg-muted/20">
      {themeVars && <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars}}` }} />}
      <PortalChrome fundName={fundName} logoUrl={fund?.logoUrl ?? null} userEmail={user?.email ?? ''}>
        {children}
      </PortalChrome>
    </div>
  )
}
