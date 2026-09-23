import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppRuntimeProvider } from '@/components/app-runtime'
import { AccessProvider, useAccess, type ClientAccess } from '@/components/access-context'
import { FeatureVisibilityProvider } from '@/components/feature-visibility-context'
import { CurrencyProvider } from '@/components/currency-context'
import { AnalystProvider, useAnalystContext } from '@/components/analyst-context'
import { AnalystConversation } from '@/components/analyst-conversation'
import { AnalystToggleButton } from '@/components/analyst-button'
import { MobileDrawerPanel } from '@/components/mobile-drawer-panel'
import { VehicleProvider } from '@/components/accounting-vehicle'
import { CommandPaletteProvider, CommandPaletteTrigger } from '@/components/command-palette'
import { navSectionsFor } from '@/components/app-sidebar'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'
import { Building2 } from 'lucide-react'
import { createDemoFetch } from './mock-api'
import { setDemoPathname } from './stubs/next-navigation'
import { CompanyScreen, DealsScreen, LpsScreen, NotesScreen, PlaceholderScreen, PortfolioScreen } from './screens'
import type { DemoAnswers, DemoSnapshot } from './types'

/**
 * The demo: the product's command palette and Analyst, mounted around a small rendering of the
 * snapshot. Everything under here is the app's own component tree with two substitutions made
 * through AppRuntimeProvider: `fetch` answers from the snapshot and `navigate` switches screens.
 */

// Every product area on, so the palette lists the pages and the sidebar shows the sections. The
// viewer role keeps it all read-only, exactly as the hosted demo account is.
const FEATURES: FeatureVisibilityMap = {
  ...DEFAULT_FEATURE_VISIBILITY,
  interactions: 'everyone', notes: 'everyone', lp_letters: 'everyone', asks: 'everyone', lps: 'everyone',
  lp_tracking: 'everyone', lp_portal: 'everyone', lp_activity: 'everyone', compliance: 'everyone',
  deals: 'everyone', diligence: 'everyone', accounting: 'everyone',
}
const ACCESS: ClientAccess = { role: 'viewer', features: FEATURES, grants: {}, defaults: {} }

export function DemoApp({ snapshot, answers }: { snapshot: DemoSnapshot; answers: DemoAnswers }) {
  const [href, setHref] = useState('/dashboard')
  const navigate = useCallback((next: string) => {
    setHref(next)
    setDemoPathname(next)
  }, [])
  const demoFetch = useMemo(() => createDemoFetch(snapshot, answers), [snapshot, answers])

  return (
    <AppRuntimeProvider fetch={demoFetch} navigate={navigate}>
      <FeatureVisibilityProvider value={FEATURES} isAdmin={false} lpPortalEnabled>
        <AccessProvider value={ACCESS}>
          <CurrencyProvider currency={snapshot.fund.currency}>
            <AnalystProvider hasAIKey configuredProviders={['anthropic']} defaultAIProvider="anthropic" fundName={snapshot.fund.name}>
              <VehicleProvider>
                <CommandPaletteProvider>
                  <Frame snapshot={snapshot} answers={answers} href={href} onNavigate={navigate} />
                </CommandPaletteProvider>
              </VehicleProvider>
            </AnalystProvider>
          </CurrencyProvider>
        </AccessProvider>
      </FeatureVisibilityProvider>
    </AppRuntimeProvider>
  )
}

function companyIdFrom(href: string): string | null {
  const m = href.match(/^\/companies\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function Frame({ snapshot, answers, href, onNavigate }: { snapshot: DemoSnapshot; answers: DemoAnswers; href: string; onNavigate: (href: string) => void }) {
  const access = useAccess()
  const { open, toggleOpen, setCompanyId, close } = useAnalystContext()
  const companyId = companyIdFrom(href)
  const company = companyId ? snapshot.companies.find(c => c.id === companyId) ?? null : null

  // The Analyst follows the screen, as it does in the product: a company page scopes it to that
  // company, everything else is the portfolio.
  useEffect(() => { setCompanyId(company?.id ?? null) }, [company?.id, setCompanyId])

  // Open on arrival where there is room for it, so the point of the demo is on screen.
  useEffect(() => {
    if (!open && window.matchMedia('(min-width: 1024px)').matches) toggleOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const suggestions = company
    ? [...(answers.suggestions.company[company.id] ?? []), ...answers.suggestions.portfolio.slice(0, 2)]
    : answers.suggestions.portfolio

  const sections = navSectionsFor(false, access)

  let screen: React.ReactNode
  if (company) screen = <CompanyScreen snapshot={snapshot} company={company} />
  else if (href === '/dashboard' || href === '/' || href === '/start') screen = <PortfolioScreen snapshot={snapshot} onOpen={onNavigate} />
  else if (href.startsWith('/lps')) screen = <LpsScreen snapshot={snapshot} />
  else if (href.startsWith('/deals')) screen = <DealsScreen snapshot={snapshot} />
  else if (href.startsWith('/notes')) screen = <NotesScreen snapshot={snapshot} />
  else screen = <PlaceholderScreen href={href} />

  return (
    <div className="oa-demo flex min-h-[640px] flex-col overflow-hidden rounded-card border bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <button type="button" onClick={() => onNavigate('/dashboard')} className="flex items-center gap-2 text-sm font-medium">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted"><Building2 className="h-4 w-4" /></span>
          {snapshot.fund.name}
        </button>
        <div className="flex items-center gap-1.5">
          <CommandPaletteTrigger />
          <AnalystToggleButton />
        </div>
      </header>

      <div className="flex flex-1">
        <nav className="hidden w-44 shrink-0 border-r p-2 md:block" aria-label="Sections">
          {sections.map(item => {
            const Icon = item.icon
            const active = href === item.href || (item.href !== '/dashboard' && href.startsWith(item.href))
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => onNavigate(item.href)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${active ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="flex min-w-0 flex-1 gap-4 p-4">
          <main className="min-w-0 flex-1">{screen}</main>
          <MobileDrawerPanel open={open} onOpenChange={isOpen => { if (!isOpen) close() }}>
            <AnalystConversation variant="panel" onClose={close} autoFocus={false} suggestions={suggestions} />
          </MobileDrawerPanel>
        </div>
      </div>
    </div>
  )
}
