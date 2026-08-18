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
 * The phone's navigation: a tab bar docked to the bottom edge of the screen, with
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
 * DOCKED rather than floating: pinned to the bottom edge, full-bleed, opaque, with a
 * single hairline along its top. It was floating first — inset on three sides, rounded,
 * translucent — and in a standalone PWA that reads as an element that failed to reach
 * the edge rather than as a deliberate gap: the bar sits visibly high, content slides
 * under its shoulders, and the strip beneath it is dead space that belongs to nothing.
 * Sitting on the edge, with the background carried all the way across, is what makes it
 * read as the app's own frame.
 *
 * Docking also buys the page back most of what floating cost it: ~65px of bar, against
 * ~90px of bar and 24px of gutter. The tabs keep their height and the room around each
 * icon — what goes is the air underneath, which is the part that was never content.
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
 * What a page must reserve at its foot so the docked bar does not sit on the last row
 * of content. Exported so app-shell.tsx cannot drift from it by a pixel, which is
 * exactly what happened when the two were written out separately.
 *
 * 4.5rem = the 3.5rem tab, the bar's 0.25rem inner padding top and bottom, its 1px top
 * border, and a little clearance — 65px of bar against 72px reserved. On top of that
 * comes the bar's own bottom padding, which is the same max() it uses, so the two
 * cannot disagree about how much room the home indicator is taking.
 *
 * The literal lives in this file so Tailwind's scanner sees it; app-shell only
 * interpolates the constant.
 */
export const MOBILE_TAB_BAR_SPACER =
  'pb-[calc(4.5rem+max(0.75rem,env(safe-area-inset-bottom)))] md:pb-0'

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
      {/* Docked to the bottom edge and full width, so the surface runs corner to corner
          rather than ending in a gutter. z-40 sits under the sheet overlay (z-50), so
          the More sheet covers the bar it was opened from.

          Opaque, not translucent: content passing beneath a bar that touches the edge
          is what made it read as a second, floating layer, and an opaque surface also
          drops the backdrop-filter that was being re-evaluated every frame the app's
          longest tables scrolled under it — on the device with the least to spend.
          A single top hairline is the only separation it needs.

          The padding pays the home indicator back INSIDE the bar rather than under it,
          so the background still reaches the bottom of the screen while the tabs clear
          the indicator.

          The SAME 0.75rem on all three open sides, so the tab row is inset equally from
          the bottom, left and right rather than sitting in the corners. It is the gap
          that was settled on against an installed iPhone: 0.5rem still read as the
          labels touching the edge, 1rem as more room than the bar needs.

          max() rather than the inset alone on each, because every env(safe-area-inset-*)
          is 0 here: the app does not use viewport-fit=cover (see app/layout.tsx), so iOS
          stops the viewport short of the home indicator instead of reporting an inset,
          and a bar with no padding of its own ends up with its labels against the
          gesture bar. The floor is what gives the gap today; the inset wins the day the
          app does go edge-to-edge — including left/right, which is where a landscape
          handset puts its notch — without any of this needing to be found again. */}
      <nav
        aria-label="Primary"
        className={
          'md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background ' +
          'pb-[max(0.75rem,env(safe-area-inset-bottom))] ' +
          'pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]'
        }
      >
        {/* The bar spans the screen; the tabs themselves stay centred and capped, so
            they do not stretch into thumb-hostile corners on a wide handset. */}
        <div className={`grid ${COLS[Math.min(tabs.length + 1, 5)]} mx-auto max-w-md p-1`}>
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
