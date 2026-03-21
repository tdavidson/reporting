'use client'
import { useState } from 'react'
import { Menu, LogOut, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { AppSidebar } from '@/components/app-sidebar'
import { useSidebar } from '@/components/sidebar-context'
import { DisplayPanelButton, DisplayPanel } from '@/components/display-panel'
import type { FeatureVisibilityMap } from '@/lib/types/features'

interface AppHeaderProps {
  fundName: string
  fundLogo?: string | null
  userEmail: string
  reviewBadge: number
  settingsBadge?: number
  notesBadge?: number
  isAdmin?: boolean
  featureVisibility?: FeatureVisibilityMap
}

export function AppHeader({ fundName, fundLogo, userEmail, reviewBadge, settingsBadge, notesBadge, isAdmin, featureVisibility }: AppHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { collapsed } = useSidebar()

  return (
    <header className="relative flex items-center justify-between px-4 py-3 shrink-0">
      {/* Left */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden p-1.5"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
        {fundLogo ? (
          <img src={fundLogo} alt="" className="h-7 w-7 rounded object-contain" />
        ) : (
          <div className="h-7 w-7 rounded bg-muted flex items-center justify-center">
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        {!collapsed && (
          <span className="font-medium text-sm text-muted-foreground tracking-tight truncate">{fundName}</span>
        )}
      </div>

      {collapsed && (
        <span className="hidden md:block absolute left-24 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground/70 tracking-tight">
          {fundName}
        </span>
      )}

      {/* Right */}
      <div className="flex items-center gap-3">
        <DisplayPanelButton />
        <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[200px]">
          {userEmail}
        </span>
        <form action="/api/auth/logout" method="POST">
          <Button type="submit" variant="outline" size="sm" className="text-muted-foreground gap-2">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </form>
      </div>

      <DisplayPanel />

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="p-0 pt-12 w-64">
          <AppSidebar
            reviewBadge={reviewBadge}
            settingsBadge={settingsBadge}
            notesBadge={notesBadge}
            isAdmin={isAdmin}
            featureVisibility={featureVisibility}
            onNavigate={() => setDrawerOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </header>
  )
}
