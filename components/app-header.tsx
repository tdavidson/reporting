'use client'
import { useState } from 'react'
import { Menu, LogOut, Building2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { AppSidebar } from '@/components/app-sidebar'
import { useSidebar } from '@/components/sidebar-context'
import { useDisplayUnit } from '@/components/display-unit-context'
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
  const [unitOpen, setUnitOpen] = useState(false)
  const { collapsed } = useSidebar()
  const { displayUnit, setDisplayUnit } = useDisplayUnit()

  const unitLabels = { full: 'Full', millions: 'Millions', thousands: 'Thousands' }

  return (
    <header className="relative flex items-center justify-between px-4 py-3 shrink-0">
      {/* Left: hamburger + logo + fund name */}
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

      {/* Right: unit selector + user + sign out */}
      <div className="flex items-center gap-3">
        {/* Display unit dropdown */}
        <div className="relative">
          <button
            onClick={() => setUnitOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1.5 hover:bg-accent transition-colors"
          >
            {unitLabels[displayUnit]}
            <ChevronDown className="h-3 w-3" />
          </button>
          {unitOpen && (
            <div className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-md z-50 min-w-[120px]">
              {(['full', 'millions', 'thousands'] as const).map(unit => (
                <button
                  key={unit}
                  onClick={() => { setDisplayUnit(unit); setUnitOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors ${displayUnit === unit ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                >
                  {unitLabels[unit]}
                </button>
              ))}
            </div>
          )}
        </div>

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
