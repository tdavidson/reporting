'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import { ArrowDownCircle, ChevronsUpDown, Lock, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react'
import { useSidebar } from '@/components/sidebar-context'
import { useAccess } from '@/components/access-context'
import { useVehicle } from '@/components/accounting-vehicle'
import {
  currentSectionFor, navItemMatches, navSectionsFor, visibleChildrenFor, useFundSeg, vehicleTargetPath,
  type NavItem, type NavChild,
} from '@/components/app-sidebar'
import type { FeatureVisibilityMap } from '@/lib/types/features'

/**
 * The desktop nav: an icon rail of sections and, beside it, a panel of the current section's
 * sub-pages.
 *
 * This replaces a 224px sidebar that listed every section and opened the current one as an
 * accordion — twelve rows deep for Entities, with the entity you were in nowhere in it. The
 * split moves each job to the surface that suits it. The rail is the map: every section, always
 * visible, one glyph and a word each, the badges on top. The panel is the orientation: which
 * section, which entity, which page, and what is next to it — and it exists only where there is
 * something to orient, so Deals and Inbound get the width back.
 *
 * The command palette (⌘K) is the third surface, for anyone who knows the name of the page.
 * All three are rendered from the same list and the same resolver (app-sidebar.tsx), so they
 * cannot answer the access question differently; that list is the thing the tests pin.
 *
 * The phone is not here. Below `md` the shell renders the tab bar and its More sheet instead.
 */

export interface DesktopNavProps {
  reviewBadge: number
  settingsBadge?: number
  notesBadge?: number
  pendingActionsBadge?: number
  isAdmin?: boolean
  updateAvailable?: boolean
  featureVisibility?: FeatureVisibilityMap
  /** Derived, not a setting: true when the fund holds at least one fund. */
  fofActive?: boolean
}

/**
 * What the two surfaces share: the visible sections, the one the URL is in, and its visible
 * children. Computed once in the shell and handed to both, so the rail's highlight and the
 * panel's contents cannot disagree, and so the shell knows whether there is a panel at all.
 */
export function useDesktopNav(props: DesktopNavProps) {
  const { isAdmin, reviewBadge, pendingActionsBadge, fofActive } = props
  const pathname = usePathname()
  const access = useAccess()
  const fundSeg = useFundSeg()
  const { kind } = useVehicle()
  const { panelHidden } = useSidebar()

  return useMemo(() => {
    const sections = navSectionsFor(!!isAdmin, access, { review: reviewBadge, pendingActions: pendingActionsBadge })
    const section = currentSectionFor(pathname, sections)
    const children = section ? visibleChildrenFor(section, !!isAdmin, access, { fofActive, fundSeg, kind }) : []
    // Entities always has a panel while the section is visible: even with no listed page, it
    // carries the entity switcher.
    const hasPanel = !!section && (children.length > 0 || section.href === '/funds')
    return { sections, section, children, hasPanel, panelVisible: hasPanel && !panelHidden }
  }, [isAdmin, access, reviewBadge, pendingActionsBadge, pathname, fofActive, fundSeg, kind, panelHidden])
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

const THEME_CYCLE = ['system', 'light', 'dark'] as const
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon }
const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' }

interface AppRailProps extends DesktopNavProps {
  sections: NavItem[]
  /** Whether the current section has a panel — the show/hide toggle is only offered when so. */
  hasPanel: boolean
}

export function AppRail({ sections, hasPanel, reviewBadge, settingsBadge, pendingActionsBadge, isAdmin, updateAvailable, featureVisibility }: AppRailProps) {
  const pathname = usePathname()
  const { panelHidden, togglePanel } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const currentTheme = (THEME_CYCLE.includes(theme as typeof THEME_CYCLE[number]) ? theme : 'system') as typeof THEME_CYCLE[number]
  const ThemeIcon = mounted ? THEME_ICONS[currentTheme] : Monitor
  const themeLabel = mounted ? THEME_LABELS[currentTheme] : 'System'
  const cycleTheme = () => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(currentTheme) + 1) % THEME_CYCLE.length])

  return (
    <nav aria-label="Sections" className="flex flex-1 flex-col items-center gap-0.5 px-1.5 py-2">
      {sections.map(item => {
        const { href, label, railLabel, icon: Icon, badgeKey, adminOnly, featureKey } = item
        // Looser than the old sidebar's exact match, on purpose: the rail answers "which part of
        // the app", and the panel underneath it answers "which row".
        const isActive = navItemMatches(item, pathname)
        const badgeCount = badgeKey === 'review' ? reviewBadge
          : badgeKey === 'pendingActions' ? (pendingActionsBadge ?? 0)
          : badgeKey === 'settings' ? (settingsBadge ?? 0)
          : 0
        const showLock = adminOnly || (featureKey && featureVisibility?.[featureKey] === 'admin')
        return (
          <RailLink key={href} href={href} label={railLabel ?? label} title={label} active={isActive} Icon={Icon}>
            {badgeCount > 0 ? (
              <span className="absolute -top-0.5 right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-warning px-1 text-[9px] font-semibold leading-none text-white tabular-nums">
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            ) : showLock ? (
              <Lock className="absolute top-0.5 right-1 h-2.5 w-2.5 text-warning" />
            ) : null}
          </RailLink>
        )
      })}

      <div className="flex-1" />

      {/* Update available, admin only */}
      {isAdmin && updateAvailable && (
        <RailLink href="/updates" label="Update" title="Update available" active={pathname === '/updates' || pathname.startsWith('/updates/')} Icon={ArrowDownCircle} tone="warning">
          <span className="absolute top-0.5 right-1 h-2 w-2 rounded-full bg-warning" />
        </RailLink>
      )}

      <button type="button" onClick={cycleTheme} title={`Theme: ${themeLabel}`} className={RAIL_BUTTON}>
        <ThemeIcon className="h-5 w-5" />
        <span className={RAIL_LABEL}>{themeLabel}</span>
      </button>

      {hasPanel && (
        <button type="button" onClick={togglePanel} title={panelHidden ? 'Show panel' : 'Hide panel'} className={RAIL_BUTTON}>
          {panelHidden ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          <span className={RAIL_LABEL}>Panel</span>
        </button>
      )}
    </nav>
  )
}

const RAIL_LABEL = 'max-w-full truncate text-[10px] leading-none'
const RAIL_ITEM = 'relative flex w-full flex-col items-center gap-1.5 rounded-md px-1 py-2 transition-colors'
const RAIL_BUTTON = `${RAIL_ITEM} text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground`

function RailLink({ href, label, title, active, Icon, tone, children }: {
  href: string
  label: string
  title: string
  active: boolean
  Icon: NavItem['icon']
  tone?: 'warning'
  children?: React.ReactNode
}) {
  const idle = tone === 'warning' ? 'text-warning hover:bg-accent hover:text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? 'page' : undefined}
      className={`${RAIL_ITEM} ${active ? 'bg-accent text-foreground' : idle}`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className={`${RAIL_LABEL} ${active ? 'font-medium' : ''}`}>{label}</span>
      {children}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface AppPanelProps {
  section: NavItem
  childItems: NavChild[]
  notesBadge?: number
  featureVisibility?: FeatureVisibilityMap
}

export function AppPanel({ section, childItems, notesBadge, featureVisibility }: AppPanelProps) {
  const pathname = usePathname()
  const Icon = section.icon

  return (
    <aside aria-label={`${section.label} pages`} className="flex flex-col gap-0.5 px-2 py-4">
      <div className="flex items-center gap-2 px-2.5 pb-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {section.label}
      </div>

      {section.href === '/funds' && <EntitySwitcher />}

      {childItems.map(child => {
        const isActive = child.exact
          ? pathname === child.href
          : pathname === child.href || pathname.startsWith(child.href + '/')
        const showLock = child.adminOnly || (child.featureKey && featureVisibility?.[child.featureKey] === 'admin')
        return (
          <Link
            key={child.href}
            href={child.href}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${isActive ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          >
            <span className="truncate">{child.label}</span>
            {showLock && <Lock className="h-3 w-3 shrink-0 text-warning" />}
            {child.badgeKey === 'notes' && (notesBadge ?? 0) > 0 && (
              <span className="ml-auto rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">{notesBadge}</span>
            )}
          </Link>
        )
      })}
    </aside>
  )
}

/**
 * The entity switcher, at the top of the Entities panel: jump to the same page on another entity,
 * or back to the firm-wide landing that lists them all. Its value follows the URL, not the
 * remembered vehicle — on /funds/journal it says "All entities" even though a vehicle is still in
 * context, because that is the page on screen. See fundsChildrenFor for the same rule.
 */
function EntitySwitcher() {
  const pathname = usePathname()
  const router = useRouter()
  const fundSeg = useFundSeg()
  const { vehicles, setVehicle } = useVehicle()

  if (vehicles.length === 0) return null

  const current = fundSeg
    ? vehicles.find(v => v.id === fundSeg || v.name === decodeURIComponent(fundSeg))
    : undefined

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const opt = vehicles.find(v => v.name === e.target.value)
    if (opt) setVehicle(opt.name, opt.id ?? null)
    router.push(vehicleTargetPath(pathname, opt ? (opt.id ?? encodeURIComponent(opt.name)) : null))
  }

  return (
    <div className="relative mx-0.5 mb-2">
      <select
        value={current?.name ?? ''}
        onChange={onChange}
        aria-label="Entity"
        className="h-8 w-full appearance-none truncate rounded-md border bg-transparent pl-2.5 pr-7 text-sm text-foreground hover:bg-accent transition-colors"
      >
        <option value="">All entities</option>
        {vehicles.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}
