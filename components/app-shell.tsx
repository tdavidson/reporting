'use client'

import { usePathname } from 'next/navigation'
import { SidebarProvider, useSidebar } from '@/components/sidebar-context'
import { CurrencyProvider } from '@/components/currency-context'
import { AnalystProvider } from '@/components/analyst-context'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { AppFooter } from '@/components/app-footer'
import { FeatureVisibilityProvider } from '@/components/feature-visibility-context'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureVisibilityMap } from '@/lib/types/features'

interface AppShellProps {
  fundName: string
  fundLogo: string | null
  userEmail: string
  reviewBadge: number
  settingsBadge?: number
  notesBadge?: number
  isAdmin?: boolean
  currency?: string
  hasAIKey?: boolean
  configuredProviders?: string[]
  defaultAIProvider?: string
  updateAvailable?: boolean
  featureVisibility?: FeatureVisibilityMap
  children: React.ReactNode
}

export function AppShell({ fundName, fundLogo, userEmail, reviewBadge, settingsBadge, notesBadge, isAdmin, currency, hasAIKey, configuredProviders, defaultAIProvider, updateAvailable, featureVisibility, children }: AppShellProps) {
  return (
    <FeatureVisibilityProvider value={featureVisibility ?? DEFAULT_FEATURE_VISIBILITY} isAdmin={isAdmin}>
    <CurrencyProvider currency={currency ?? 'USD'}>
      <SidebarProvider>
        <AnalystProvider hasAIKey={hasAIKey ?? false} configuredProviders={configuredProviders ?? []} defaultAIProvider={defaultAIProvider ?? 'anthropic'} fundName={fundName}>
          <AppShellInner
            fundName={fundName}
            fundLogo={fundLogo}
            userEmail={userEmail}
            reviewBadge={reviewBadge}
            settingsBadge={settingsBadge}
            notesBadge={notesBadge}
            isAdmin={isAdmin}
            updateAvailable={updateAvailable}
            featureVisibility={featureVisibility}
          >
            {children}
          </AppShellInner>
        </AnalystProvider>
      </SidebarProvider>
    </CurrencyProvider>
    </FeatureVisibilityProvider>
  )
}

function AppShellInner({ fundName, fundLogo, userEmail, reviewBadge, settingsBadge, notesBadge, isAdmin, updateAvailable, featureVisibility, children }: AppShellProps) {
  const { collapsed } = useSidebar()
  const pathname = usePathname()

  // The LP-portal preview renders full-screen (no GP header/sidebar) so it looks
  // like the real /portal an LP logs into.
  if (pathname === '/lps/preview') {
    return <>{children}</>
  }

  return (
    <>
      <AppHeader
        fundName={fundName}
        fundLogo={fundLogo}
        userEmail={userEmail}
        reviewBadge={reviewBadge}
        settingsBadge={settingsBadge}
        notesBadge={notesBadge}
        isAdmin={isAdmin}
        featureVisibility={featureVisibility}
      />

      <div className="flex flex-1">
        {/* Desktop sidebar, always rendered, width varies */}
        <aside
          className={`hidden md:flex flex-col shrink-0 pt-6 transition-all duration-200 ${
            collapsed ? 'w-16' : 'w-56'
          }`}
        >
          <AppSidebar reviewBadge={reviewBadge} settingsBadge={settingsBadge} notesBadge={notesBadge} isAdmin={isAdmin} updateAvailable={updateAvailable} featureVisibility={featureVisibility} />
        </aside>

        {/* Page content */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1">
            {children}
          </div>
          <AppFooter />
        </main>
      </div>
    </>
  )
}
