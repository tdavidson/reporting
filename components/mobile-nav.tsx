'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { mobileTabsFor, navItemMatches } from '@/components/app-sidebar'
import { MobileMoreSheet } from '@/components/mobile-more-sheet'
import { useAccess } from '@/components/access-context'
import type { FeatureVisibilityMap } from '@/lib/types/features'

/**
 * The phone's navigation: a floating tab bar near the bottom of the screen, with
 * everything else behind "More".
 *
 * This replaces a hamburger in the header that opened the desktop sidebar in a drawer
 * — the whole sidebar, twenty-odd rows of it, in a container that could not scroll.
 * See MOBILE_TAB_HREFS in app-sidebar.tsx for why a tab bar is the right shape for a
 * handset, and mobile-more-sheet.tsx for what "More" opens now that it is no longer
 * that sidebar.
 *
 * Bottom rather than top because this app is installed on phones. In a standalone PWA
 * the nav is the only chrome there is, and the bottom of the screen is where a thumb
 * reaches — the top-left corner, where the hamburger was, is the furthest point from
 * it on a modern handset.
 *
 * FLOATING rather than edge-to-edge: inset on three sides, rounded, translucent, with
 * the page visibly running underneath it. A full-bleed bar welded to the bottom edge
 * reads as the device's own chrome, which is exactly the wrong signal in a standalone
 * window where it is the app's only chrome and the only way out of a page.
 *
 * It costs the page about 43px against the bar it replaced (96 reserved, against 53),
 * and that is the trade being made deliberately: taller tabs, room around each icon,
 * and a real gap under the bar rather than a strip of chrome pressed into the corner
 * of the screen. The page under it scrolls — the bar does not — so what is spent is
 * 43px of the LAST screenful, once, not of every screen.
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

/**
 * Tap-target height of a tab: 56px, comfortably over the 44px both platforms ask for,
 * and 4px more than before because the icon now sits in a pill with room around it
 * rather than pressed against the label.
 */
const TAB_HEIGHT = 'min-h-[3.5rem]'

/**
 * What a page must reserve at its foot so the floating bar does not sit on the last row
 * of content. Exported so app-shell.tsx cannot drift from it by a pixel, which is
 * exactly what happened when the two were written out separately.
 *
 * 6rem = the 3.5rem tab, the bar's 0.25rem inner padding top and bottom, its two 1px
 * borders, the 1.5rem it floats above the bottom edge, and a little clearance — 90px of
 * bar against 96px reserved. On top of that comes the home-indicator inset, which the
 * bar also pays back so it never sits under the indicator itself.
 *
 * The literal lives in this file so Tailwind's scanner sees it; app-shell only
 * interpolates the constant.
 */
export const MOBILE_TAB_BAR_SPACER = 'pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0'

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
  const [moreOpen, setMoreOpen] = useState(false)
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
  // sheet, which is exactly the state you would not think to check.
  const shownBadges = new Set(tabs.map(t => t.badgeKey).filter(Boolean))
  const moreHasBadge =
    (['review', 'pendingActions', 'settings', 'notes'] as const).some(
      key => !shownBadges.has(key) && badgeFor(key) > 0
    ) || !!updateAvailable

  return (
    <>
      {/* The gutter the bar floats in. pointer-events-none so the strip either side of
          a narrow bar does not swallow taps meant for the page underneath; the bar
          itself takes them back.

          The bottom gap is 1.5rem against 1rem at the sides — deliberately not square.
          A bar 8px off the edge reads as one that failed to reach it, and the bottom of
          a phone is the one edge with something else already competing for the space:
          the home indicator, the gesture bar, and the curve of the screen itself. On
          top of that comes env(safe-area-inset-bottom), which is 0 today because the
          app does not use viewport-fit=cover (see app/layout.tsx) — the platforms that
          need it are the ones where the viewport already stops short of the indicator
          — and correct the day that changes. */}
      <div className="md:hidden fixed inset-x-0 bottom-0 z-40 pointer-events-none px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <nav
          aria-label="Primary"
          className={
            // z-40 (on the gutter) sits under the sheet overlay (z-50) so the More
            // sheet covers the bar it was opened from.
            //
            // The translucency is what makes it read as floating rather than as a
            // second page: content scrolls visibly beneath it. backdrop-blur keeps the
            // labels legible over whatever happens to be passing under — a table of
            // figures, most of the time. Where a browser has no backdrop-filter the
            // /85 surface is still opaque enough to read against.
            'pointer-events-auto mx-auto max-w-md rounded-card border border-border ' +
            'bg-background/85 backdrop-blur-xl shadow-lg dark:shadow-none'
          }
        >
          <div className={`grid ${COLS[Math.min(tabs.length + 1, 5)]} p-1`}>
            {tabs.map(item => {
              const Icon = item.icon
              const active = navItemMatches(item, pathname)
              const count = badgeFor(item.badgeKey)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex ${TAB_HEIGHT} flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] leading-none transition-colors ${
                    active ? 'text-foreground font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <span className={`flex items-center justify-center rounded-full px-3.5 py-1 transition-colors ${active ? 'bg-accent' : ''}`}>
                    <Icon className="h-5 w-5 shrink-0" />
                  </span>
                  <span className="max-w-full truncate">{item.label}</span>
                  {count > 0 && (
                    <span className="absolute right-1/2 top-1 h-2 w-2 translate-x-4 rounded-full bg-warning" />
                  )}
                </Link>
              )
            })}

            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-label="More"
              className={`relative flex ${TAB_HEIGHT} flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] leading-none transition-colors ${
                moreOpen ? 'text-foreground font-medium' : 'text-muted-foreground'
              }`}
            >
              {/* Dots rather than a hamburger. A hamburger promises the menu it used to
                  open — a full stack of rows — and this is no longer that. */}
              <span className={`flex items-center justify-center rounded-full px-3.5 py-1 transition-colors ${moreOpen ? 'bg-accent' : ''}`}>
                <MoreHorizontal className="h-5 w-5 shrink-0" />
              </span>
              <span>More</span>
              {moreHasBadge && (
                <span className="absolute right-1/2 top-1 h-2 w-2 translate-x-4 rounded-full bg-warning" />
              )}
            </button>
          </div>
        </nav>
      </div>

      <MobileMoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        tabHrefs={tabs.map(t => t.href)}
        reviewBadge={reviewBadge}
        settingsBadge={settingsBadge}
        notesBadge={notesBadge}
        pendingActionsBadge={pendingActionsBadge}
        isAdmin={isAdmin}
        updateAvailable={updateAvailable}
        featureVisibility={featureVisibility}
        fofActive={fofActive}
      />
    </>
  )
}
