'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ClipboardCheck, Mail, Upload, Send, Settings, LifeBuoy, PanelLeftClose, PanelLeftOpen, Monitor, Sun, Moon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { useSidebar } from '@/components/sidebar-context'

const THEME_CYCLE = ['system', 'light', 'dark'] as const
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon }
const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' }

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; badge?: boolean }[] = [
  { href: '/dashboard', label: 'Portfolio', icon: LayoutDashboard },
  { href: '/review', label: 'Review', icon: ClipboardCheck, badge: true },
  { href: '/emails', label: 'Email Log', icon: Mail },
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/requests', label: 'Responses', icon: Send },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/support', label: 'Support', icon: LifeBuoy },
]

interface AppSidebarProps {
  reviewBadge: number
  onNavigate?: () => void
}

export function AppSidebar({ reviewBadge, onNavigate }: AppSidebarProps) {
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
        {NAV_ITEMS.map(({ href, label, icon: Icon, badge }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
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
              <Icon className="h-4 w-4 shrink-0" />
              <span className={`${collapsed ? 'md:hidden' : ''}`}>{label}</span>
              {badge && reviewBadge > 0 && (
                collapsed ? (
                  <span className="hidden md:block absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />
                ) : (
                  <span className="rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none px-1.5 py-0.5 min-w-[18px] text-center">
                    {reviewBadge > 99 ? '99+' : reviewBadge}
                  </span>
                )
              )}
            </Link>
          )
        })}

        {/* Theme toggle */}
        <button
          onClick={cycleTheme}
          title={collapsed ? themeLabel : undefined}
          className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-xs transition-colors text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent ${
            collapsed ? 'md:justify-center md:px-0' : ''
          }`}
        >
          <ThemeIcon className="h-4 w-4 shrink-0" />
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
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          ) : (
            <PanelLeftClose className="h-4 w-4 shrink-0" />
          )}
          <span className={`flex-1 text-left ${collapsed ? 'md:hidden' : ''}`}>
            {collapsed ? 'Show Sidebar' : 'Hide Sidebar'}
          </span>
        </button>
      </nav>
    </div>
  )
}
