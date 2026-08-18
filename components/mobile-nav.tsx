'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { AppSidebar, mobileTabsFor, navItemMatches } from '@/components/app-sidebar'
import { useAccess } from '@/components/access-context'
import type { FeatureVisibilityMap } from '@/lib/types/features'

/**
 * The phone's navigation: a tab bar along the bottom, and the full sidebar behind
 * "More".
 *
 * This replaces a hamburger in the header that opened the desktop sidebar in a drawer
 * — the whole sidebar, twenty-odd rows of it, in a container that could not scroll.
 * See MOBILE_TAB_HREFS in app-sidebar.tsx for why a tab bar is the right shape for a
 * handset, and SheetContent for the scrolling.
 *
 * Bottom rather than top because this app is installed on phones. In a standalone PWA
 * the nav is the only chrome there is, and the bottom of the screen is where a thumb
 * reaches — the top-left corner, where the hamburger was, is the furthest point from
 * it on a modern handset.
 */
interface MobileNavProps {
  reviewBadge: number
  settingsBadge?: number
  notesBadge?: number
  pendingActionsBadge?: number
  isAdmin?: boolean
  updateAvailable?: boolean
  featureVisibility?: FeatureVisibilityMap
  fofActive?: boolean
}

/** Tailwind needs the class literal in the source, so the count indexes a list. */
const COLS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5']

/** Tap-target height of a tab. Below the 44px both platforms ask for would be a miss. */
const TAB_HEIGHT = 'min-h-[3.25rem]'

/**
 * What a page must reserve at its foot so the fixed bar does not sit on the last row of
 * content — the tab height, the bar's top border, and the home-indicator inset it pays
 * back. Exported so app-shell.tsx cannot drift from it by a pixel, which is exactly
 * what happened when the two were written out separately.
 *
 * The literal lives in this file so Tailwind's scanner sees it; app-shell only
 * interpolates the constant.
 */
export const MOBILE_TAB_BAR_SPACER = 'pb-[calc(3.25rem+1px+env(safe-area-inset-bottom))] md:pb-0'

export function MobileNav({
  reviewBadge,
  settingsBadge,
  notesBadge,
  pendingActionsBadge,
  isAdmin,
  updateAvailable,
  featureVisibility,
  fofActive,
}: MobileNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()
  const access = useAccess()

  // Same resolver the sidebar and the middleware use, so the bar cannot offer a page
  // the user's own API calls would refuse.
  const tabs = mobileTabsFor(!!isAdmin, access)

  const badgeFor = (key: string | undefined) =>
    key === 'review' ? reviewBadge
      : key === 'pendingActions' ? (pendingActionsBadge ?? 0)
      : key === 'settings' ? (settingsBadge ?? 0)
      : key === 'notes' ? (notesBadge ?? 0)
      : 0

  // "More" carries a dot for anything waiting that no tab is already showing —
  // otherwise a pending settings item or review queue is invisible until you open the
  // drawer, which is exactly the state you would not think to check.
  const shownBadges = new Set(tabs.map(t => t.badgeKey).filter(Boolean))
  const moreHasBadge =
    (['review', 'pendingActions', 'settings', 'notes'] as const).some(
      key => !shownBadges.has(key) && badgeFor(key) > 0
    ) || !!updateAvailable

  return (
    <>
      <nav
        aria-label="Primary"
        className={
          // z-40 sits under the sheet overlay (z-50) so the drawer covers the bar it
          // was opened from. pb-safe pays back the home-indicator inset: the app does
          // not use viewport-fit=cover (see app/layout.tsx), so this is 0 today and
          // correct the day that changes.
          'md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]'
        }
      >
        <div className={`grid ${COLS[Math.min(tabs.length + 1, 5)]}`}>
          {tabs.map(item => {
            const Icon = item.icon
            const active = navItemMatches(item, pathname)
            const count = badgeFor(item.badgeKey)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // min-h-[3.25rem] keeps every tab a comfortable tap target even where
                // the label wraps to nothing.
                className={`relative flex ${TAB_HEIGHT} flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] leading-none transition-colors ${
                  active ? 'text-foreground font-medium' : 'text-muted-foreground'
                }`}
              >
                <span className={`flex items-center justify-center rounded-full px-3 py-0.5 ${active ? 'bg-accent' : ''}`}>
                  <Icon className="h-5 w-5 shrink-0" />
                </span>
                <span className="max-w-full truncate">{item.label}</span>
                {count > 0 && (
                  <span className="absolute right-1/2 top-0.5 h-2 w-2 translate-x-3.5 rounded-full bg-warning" />
                )}
              </Link>
            )
          })}

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            className={`relative flex ${TAB_HEIGHT} flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] leading-none text-muted-foreground`}
          >
            <span className="flex items-center justify-center rounded-full px-3 py-0.5">
              <Menu className="h-5 w-5 shrink-0" />
            </span>
            <span>More</span>
            {moreHasBadge && (
              <span className="absolute right-1/2 top-0.5 h-2 w-2 translate-x-3.5 rounded-full bg-warning" />
            )}
          </button>
        </div>
      </nav>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        {/* The full sidebar, in `mobile` mode so a desktop collapse preference does not
            hide every sub-page here. SheetContent scrolls — without that the bottom
            third of this list is unreachable. */}
        <SheetContent side="left" className="w-72 max-w-[85vw] p-0 pt-12">
          <AppSidebar
            mobile
            reviewBadge={reviewBadge}
            settingsBadge={settingsBadge}
            notesBadge={notesBadge}
            pendingActionsBadge={pendingActionsBadge}
            isAdmin={isAdmin}
            updateAvailable={updateAvailable}
            featureVisibility={featureVisibility}
            fofActive={fofActive}
            onNavigate={() => setDrawerOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
