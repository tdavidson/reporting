'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, ClipboardCheck, Mail, Upload, Send, Settings, PanelLeftClose, PanelLeftOpen, BarChart3, StickyNote, Lock, Users, Handshake, ArrowDownCircle, FileText, Briefcase, Crown, ShieldCheck, Newspaper, Globe2, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useSidebar } from '@/components/sidebar-context'
import { isFeatureVisible } from '@/lib/types/features'
import type { FeatureKey, FeatureVisibilityMap } from '@/lib/types/features'

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; badgeKey?: 'review' | 'settings' | 'notes'; adminOnly?: boolean; featureKey?: FeatureKey; beta?: boolean }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Building2 },
  { href: '/review', label: 'Review', icon: ClipboardCheck, badgeKey: 'review' },
  { href: '/emails', label: 'E-mail', icon: Mail },
  { href: '/import', label: 'Import', icon: Upload, featureKey: 'imports' },
  { href: '/investments', label: 'Investments', icon: BarChart3, featureKey: 'investments' },
  { href: '/benchmarking', label: 'Benchmarking', icon: TrendingUp, featureKey: 'investments', beta: true },
  { href: '/funds', label: 'Vehicles', icon: Briefcase, featureKey: 'funds' },
  { href: '/requests', label: 'Asks', icon: Send, featureKey: 'asks' },
  { href: '/notes', label: 'Notes', icon: StickyNote, badgeKey: 'notes', featureKey: 'notes' },
  { href: '/news', label: 'News', icon: Newspaper },
  { href: '/vc-market', label: 'VC Market', icon: Globe2, featureKey: 'vc_market' },
  { href: '/interactions', label: 'Interactions', icon: Handshake, featureKey: 'interactions' },
  { href: '/letters', label: 'Letters', icon: FileText, featureKey: 'lp_letters' },
  { href: '/lps', label: 'LPs', icon: Crown, featureKey: 'lps' },
  { href: '/compliance', label: 'Compliance', icon: ShieldCheck, featureKey: 'compliance', beta: true },
  { href: '/usage', label: 'Usage', icon: Users, adminOnly: true },
  { href: '/settings', label: 'Settings', icon: Settings, badgeKey: 'settings' },
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


  return (
    <div className="flex flex-col flex-1">
      <nav className={`flex-1 p-2 space-y-0.5 ${collapsed ? 'md:px-1' : ''}`}>
        {NAV_ITEMS.filter(item => {
          if (item.adminOnly && !isAdmin) return false
          if (item.featureKey && !isFeatureVisible(featureVisibility, item.featureKey, !!isAdmin)) return false
          return true
        }).map(({ href, label, icon: Icon, badgeKey, adminOnly, featureKey, beta }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          const badgeCount = badgeKey === 'review' ? reviewBadge
            : badgeKey === 'settings' ? (settingsBadge ?? 0)
            : badgeKey === 'notes' ? (notesBadge ?? 0)
            : 0
          const showLock = adminOnly || (featureKey && featureVisibility?.[featureKey] === 'admin')
          return (
            <Link
              key={href}
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
