'use client'
import { SidebarProvider, useSidebar } from '@/components/sidebar-context'
import { CurrencyProvider } from '@/components/currency-context'
import { AnalystProvider } from '@/components/analyst-context'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { FeatureVisibilityProvider } from '@/components/feature-visibility-context'
import { DisplayUnitProvider } from '@/components/display-unit-context'
import { DisplayPanelProvider } from '@/components/display-panel-context'
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
    <FeatureVisibilityProvider value={featureVisibility ?? DEFAULT_FEATURE_VISIBILITY}>
    <CurrencyProvider currency={currency ?? 'USD'}>
    <DisplayUnitProvider>
    <DisplayPanelProvider>
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
    </DisplayPanelProvider>
    </DisplayUnitProvider>
    </CurrencyProvider>
    </FeatureVisibilityProvider>
  )
}

function AppShellInner({ fundName, fundLogo, userEmail, reviewBadge, settingsBadge, notesBadge, isAdmin, updateAvailable, featureVisibility, children }: AppShellProps) {
  const { collapsed } = useSidebar()
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
<div className="flex flex-1 min-h-0">
  <aside
    className={`hidden md:flex flex-col shrink-0 pt-6 transition-all duration-200 border-r border-border/60 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto
   ${
      collapsed ? 'w-16' : 'w-56'
    }`}
        >
          <AppSidebar reviewBadge={reviewBadge} settingsBadge={settingsBadge} notesBadge={notesBadge} isAdmin={isAdmin} updateAvailable={updateAvailable} featureVisibility={featureVisibility} />
        </aside>
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8">
            {children}
          </div>
        </main>
      </div>
    </>
  )
}
