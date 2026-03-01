'use client'

import { SidebarProvider, useSidebar } from '@/components/sidebar-context'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { AppFooter } from '@/components/app-footer'

interface AppShellProps {
  fundName: string
  fundLogo: string | null
  userEmail: string
  reviewBadge: number
  children: React.ReactNode
}

export function AppShell({ fundName, fundLogo, userEmail, reviewBadge, children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellInner
        fundName={fundName}
        fundLogo={fundLogo}
        userEmail={userEmail}
        reviewBadge={reviewBadge}
      >
        {children}
      </AppShellInner>
    </SidebarProvider>
  )
}

function AppShellInner({ fundName, fundLogo, userEmail, reviewBadge, children }: AppShellProps) {
  const { collapsed } = useSidebar()

  return (
    <>
      <AppHeader
        fundName={fundName}
        fundLogo={fundLogo}
        userEmail={userEmail}
        reviewBadge={reviewBadge}
      />

      <div className="flex flex-1">
        {/* Desktop sidebar — always rendered, width varies */}
        <aside
          className={`hidden md:flex flex-col shrink-0 pt-6 transition-all duration-200 ${
            collapsed ? 'w-14' : 'w-56'
          }`}
        >
          <AppSidebar reviewBadge={reviewBadge} />
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
