'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, ClipboardCheck, Mail, Upload, Send, Settings, LifeBuoy, PanelLeftClose, PanelLeftOpen, Monitor, Sun, Moon, BarChart3, TrendingUp, StickyNote, Lock, Users, Handshake, ArrowDownCircle, FileText, Briefcase, Crown, ShieldCheck, Lightbulb, Microscope } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { useSidebar } from '@/components/sidebar-context'
import { isFeatureVisible } from '@/lib/types/features'
import type { FeatureKey, FeatureVisibilityMap } from '@/lib/types/features'

const THEME_CYCLE = ['system', 'light', 'dark'] as const
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon }
const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' }

interface NavChild {
  href: string
  label: string
  adminOnly?: boolean
  featureKey?: FeatureKey
}
interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  badgeKey?: 'review' | 'settings' | 'notes'
  adminOnly?: boolean
  featureKey?: FeatureKey
  beta?: boolean
  children?: NavChild[]
}

const NAV_ITEMS: NavItem[] = [
  { href: '/review', label: 'Review', icon: ClipboardCheck, badgeKey: 'review' },
  { href: '/emails', label: 'Inbound', icon: Mail },
  {
    href: '/deals', label: 'Deals', icon: Lightbulb, featureKey: 'deals',
    children: [
      { href: '/settings/email-audit',       label: 'Email audit',       adminOnly: true },
      { href: '/settings/routing-accuracy',  label: 'Routing accuracy',  adminOnly: true },
    ],
  },
  {
    href: '/diligence', label: 'Diligence', icon: Microscope, featureKey: 'diligence',
    children: [
      { href: '/diligence/inbox',     label: 'Inbox' },
      { href: '/diligence/analytics', label: 'Analytics' },
    ],
  },
  {
    href: '/dashboard', label: 'Portfolio', icon: Building2,
    children: [
      { href: '/import',       label: 'Import',       featureKey: 'imports' },
      { href: '/investments',  label: 'Investments',  featureKey: 'investments' },
      { href: '/requests',     label: 'Asks',         featureKey: 'asks' },
      { href: '/interactions', label: 'Interactions', featureKey: 'interactions' },
      { href: '/letters',      label: 'Letters',      featureKey: 'lp_letters' },
      { href: '/lps',          label: 'LPs',          featureKey: 'lps' },
      { href: '/compliance',   label: 'Compliance',   featureKey: 'compliance' },
      { href: '/funds',        label: 'Funds',        featureKey: 'funds' },
    ],
  },
  { href: '/notes', label: 'Notes', icon: StickyNote, badgeKey: 'notes', featureKey: 'notes' },
  { href: '/usage', label: 'Usage', icon: Users, adminOnly: true },
  { href: '/settings', label: 'Settings', icon: Settings, badgeKey: 'settings' },
  { href: '/support', label: 'Support', icon: LifeBuoy },
]

interface AppSidebarProps {
  reviewBadge: number
  settingsBadge?: number
  notesBadge?: number
  isAdmin?: boolean
  updateAvailable?: boolean
  featureVisibility?: FeatureVisibilityMap
  onNavigate?: () => void
}

export function AppSidebar({ reviewBadge, settingsBadge, notesBadge, isAdmin, updateAvailable, featureVisibility, onNavigate }: AppSidebarProps) {
  const pathname = usePathname()
  const { collapsed, toggle } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const currentTheme = (THEME_CYCLE.includes(theme as typeof THEME_CYCLE[number]) ? theme : 'system') as typeof THEME_CYCLE[number]
  const ThemeIcon = mounted ? THEME_ICONS[currentTheme] : Monitor
  const themeLabel = mounted ? THEME_LABELS[currentTheme] : 'System'

  function cycleTheme() {
    const idx = THEME_CYCLE.indexOf(currentTheme)
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length])
  }

  return (
    <div className="flex flex-col flex-1">
      <nav className={`flex-1 p-2 space-y-0.5 ${collapsed ? 'md:px-1' : ''}`}>
        {NAV_ITEMS.filter(item => {
          if (item.adminOnly && !isAdmin) return false
          if (item.featureKey && !isFeatureVisible(featureVisibility, item.featureKey, !!isAdmin)) return false
          if (item.badgeKey === 'review' && reviewBadge === 0) return false
          return true
        }).map((item) => {
          const { href, label, icon: Icon, badgeKey, adminOnly, featureKey, beta, children } = item
          const isActive = pathname === href || pathname.startsWith(href + '/')
          const badgeCount = badgeKey === 'review' ? reviewBadge
            : badgeKey === 'settings' ? (settingsBadge ?? 0)
            : badgeKey === 'notes' ? (notesBadge ?? 0)
            : 0
          const showLock = adminOnly || (featureKey && featureVisibility?.[featureKey] === 'admin')

          // Children visibility — drop children that the user can't access (admin
          // gate or per-feature visibility), then show only when the parent or any
          // visible child route is active.
          const visibleChildren = (children ?? []).filter(c => {
            if (c.adminOnly && !isAdmin) return false
            if (c.featureKey && !isFeatureVisible(featureVisibility, c.featureKey, !!isAdmin)) return false
            return true
          })
          const childActive = visibleChildren.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))
          const showChildren = !collapsed && visibleChildren.length > 0 && (isActive || childActive)

          return (
            <div key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                className={`relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  collapsed ? 'md:justify-center md:px-0' : ''
                } ${
                  isActive
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className={`${collapsed ? 'md:hidden' : ''}`}>{label}</span>
                {badgeCount > 0 && (
                  collapsed ? (
                    <span className="hidden md:block absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />
                  ) : (
                    <span className="rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none px-1.5 py-0.5 min-w-[18px] text-center">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )
                )}
                {beta && !showLock && (
                  collapsed ? (
                    <span className="hidden md:block absolute top-1 right-1 h-2 w-2 rounded-full bg-blue-500" />
                  ) : (
                    <span className="text-[9px] font-medium text-blue-500 bg-blue-500/10 rounded px-1 py-0.5 leading-none uppercase tracking-wider self-center">beta</span>
                  )
                )}
                {showLock && !beta && !collapsed && (
                  <Lock className="h-3 w-3 text-amber-500 shrink-0 md:block hidden" />
                )}
                {showLock && !beta && collapsed && (
                  <span className="hidden md:block absolute top-1 right-1">
                    <Lock className="h-2.5 w-2.5 text-amber-500" />
                  </span>
                )}
                {beta && showLock && !collapsed && (
                  <>
                    <span className="text-[9px] font-medium text-blue-500 bg-blue-500/10 rounded px-1 py-0.5 leading-none uppercase tracking-wider self-center hidden md:inline">beta</span>
                    <Lock className="h-3 w-3 text-amber-500 shrink-0 md:block hidden" />
                  </>
                )}
                {beta && showLock && collapsed && (
                  <span className="hidden md:block absolute top-1 right-1">
                    <Lock className="h-2.5 w-2.5 text-blue-500" />
                  </span>
                )}
              </Link>

              {showChildren && (
                <div className="ml-5 border-l border-border pl-2 mt-0.5 space-y-0.5">
                  {visibleChildren.map(child => {
                    const childIsActive = pathname === child.href || pathname.startsWith(child.href + '/')
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                          childIsActive
                            ? 'bg-accent text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                        }`}
                      >
                        <span>{child.label}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Update available — admin only */}
        {isAdmin && updateAvailable && (() => {
          const isActive = pathname === '/updates' || pathname.startsWith('/updates/')
          return (
            <Link
              href="/updates"
              onClick={onNavigate}
              title={collapsed ? 'Updates' : undefined}
              className={`relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                collapsed ? 'md:justify-center md:px-0' : ''
              } ${
                isActive
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-amber-600 dark:text-amber-400 hover:text-foreground hover:bg-accent'
              }`}
            >
              <ArrowDownCircle className="h-5 w-5 shrink-0" />
              <span className={`${collapsed ? 'md:hidden' : ''}`}>Updates</span>
              {collapsed ? (
                <span className="hidden md:block absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
              )}
            </Link>
          )
        })()}

        {/* Theme toggle */}
        <button
          onClick={cycleTheme}
          title={collapsed ? themeLabel : undefined}
          className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-xs transition-colors text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent ${
            collapsed ? 'md:justify-center md:px-0' : ''
          }`}
        >
          <ThemeIcon className="h-5 w-5 shrink-0" />
          <span className={`flex-1 text-left ${collapsed ? 'md:hidden' : ''}`}>
            {themeLabel}
          </span>
        </button>

        {/* Hide Sidebar toggle — only shown on desktop */}
        <button
          onClick={toggle}
          title={collapsed ? 'Show Sidebar' : 'Hide Sidebar'}
          className={`hidden md:flex w-full items-center gap-3 px-3 py-2 rounded-md text-xs transition-colors text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent ${
            collapsed ? 'md:justify-center md:px-0' : ''
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5 shrink-0" />
          ) : (
            <PanelLeftClose className="h-5 w-5 shrink-0" />
          )}
          <span className={`flex-1 text-left ${collapsed ? 'md:hidden' : ''}`}>
            {collapsed ? 'Show Sidebar' : 'Hide Sidebar'}
          </span>
        </button>
      </nav>
    </div>
  )
}

