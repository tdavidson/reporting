'use client'

import { LogOut, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LpPortalSwitchLink } from '@/components/lp-portal-switch-link'
import { useSidebar } from '@/components/sidebar-context'

interface AppHeaderProps {
  fundName: string
  fundLogo?: string | null
  userEmail: string
}

// Identity and sign-out. Navigation is NOT here any more: on desktop it is the aside
// in app-shell.tsx, and on a phone it is components/mobile-nav.tsx — a bottom tab bar
// with the sidebar behind "More". The hamburger this used to carry was in the corner
// of the screen furthest from a thumb, and opened a menu a third of which could not be
// scrolled to.
export function AppHeader({ fundName, fundLogo, userEmail }: AppHeaderProps) {
  const { collapsed } = useSidebar()

  return (
    <header className="relative flex items-center justify-between px-4 py-3 shrink-0">
      {/* Left: logo + fund name */}
      <div className="flex items-center gap-3">
        {fundLogo ? (
          <img
            src={fundLogo}
            alt=""
            className="h-7 w-7 rounded object-contain"
          />
        ) : (
          <div className="h-7 w-7 rounded bg-muted flex items-center justify-center">
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        {!collapsed && (
          <span className="font-medium text-sm text-muted-foreground tracking-tight truncate">{fundName}</span>
        )}
      </div>

      {/* Fund name aligned above page content when sidebar collapsed.
          left-28 (112px) is the page content's left edge, and has to be kept in step with it:
          64 (the collapsed aside's w-16) + 16 (main's md:pl-4) + 32 (the section layout's
          md:pl-8, e.g. app/(app)/funds/layout.tsx). */}
      {collapsed && (
        <span className="hidden md:block absolute left-28 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground/70 tracking-tight">
          {fundName}
        </span>
      )}

      {/* Right: user + sign out */}
      <div className="flex items-center gap-3">
        <LpPortalSwitchLink />
        <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[200px]">
          {userEmail}
        </span>
        <form action="/api/auth/logout" method="POST">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="text-muted-foreground gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </form>
      </div>
    </header>
  )
}
