'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { Menu, Github, LogIn, Play, Home, Building2, Mail, Upload, BarChart3, Briefcase, Send, StickyNote, Handshake, FileText, Settings, LifeBuoy, Scale, MessageCircle, PanelLeftClose, PanelLeftOpen, Monitor, Sun, Moon, ChevronRight, Package, Award } from 'lucide-react'

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { SidebarProvider, useSidebar } from '@/components/sidebar-context'
import { useTheme } from 'next-themes'
import { AppFooter } from '@/components/app-footer'

const THEME_CYCLE = ['system', 'light', 'dark'] as const
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon }
const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' }

const TOP_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Home', icon: Home },
]

const PRODUCT_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard-explainer', label: 'Portfolio', icon: Building2 },
  { href: '/inbound-explainer', label: 'Inbound', icon: Mail },
  { href: '/import-explainer', label: 'Import', icon: Upload },
  { href: '/investments-explainer', label: 'Investments', icon: BarChart3 },
  { href: '/funds-explainer', label: 'Funds', icon: Briefcase },
  { href: '/asks-explainer', label: 'Asks', icon: Send },
  { href: '/notes-explainer', label: 'Notes', icon: StickyNote },
  { href: '/interactions-explainer', label: 'Interactions', icon: Handshake },
  { href: '/letters-explainer', label: 'LP Letters', icon: FileText },
  { href: '/settings-explainer', label: 'Settings', icon: Settings },
  { href: '/support-explainer', label: 'Support', icon: LifeBuoy },
]

const BOTTOM_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/pricing', label: 'Pricing', icon: Award },
  { href: '/contact', label: 'Contact', icon: MessageCircle },
  { href: '/license', label: 'License', icon: Scale },
]

function NavLink({ href, label, icon: Icon, collapsed, isActive, onNavigate, className = '' }: {
  href: string; label: string; icon: LucideIcon; collapsed: boolean; isActive: boolean; onNavigate?: () => void; className?: string
}) {
  return (
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
      } ${className}`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className={`${collapsed ? 'md:hidden' : ''}`}>{label}</span>
    </Link>
  )
}

function PublicSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { collapsed, toggle } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [productOpen, setProductOpen] = useState(false)
  useEffect(() => setMounted(true), [])

  // Auto-open product section if current page is a product page
  useEffect(() => {
    if (PRODUCT_ITEMS.some(item => pathname === item.href || pathname.startsWith(item.href + '/'))) {
      setProductOpen(true)
    }
  }, [pathname])

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
        {TOP_ITEMS.map(({ href, label, icon }) => (
          <NavLink
            key={href}
            href={href}
            label={label}
            icon={icon}
            collapsed={collapsed}
            isActive={pathname === href}
            onNavigate={onNavigate}
          />
        ))}

        {/* Collapsible Product section */}
        <div>
          <button
            onClick={() => setProductOpen(!productOpen)}
            title={collapsed ? 'Product' : undefined}
            className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent ${
              collapsed ? 'md:justify-center md:px-0' : ''
            }`}
          >
            <Package className="h-5 w-5 shrink-0" />
            <span className={`flex-1 text-left ${collapsed ? 'md:hidden' : ''}`}>Product</span>
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${productOpen ? 'rotate-90' : ''} ${collapsed ? 'md:hidden' : ''}`} />
          </button>
          {productOpen && (
            <div className={`space-y-0.5 ${collapsed ? '' : 'ml-2'}`}>
              {PRODUCT_ITEMS.map(({ href, label, icon }) => (
                <NavLink
                  key={href}
                  href={href}
                  label={label}
                  icon={icon}
                  collapsed={collapsed}
                  isActive={pathname === href || pathname.startsWith(href + '/')}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </div>

        {BOTTOM_ITEMS.map(({ href, label, icon }) => (
          <NavLink
            key={href}
            href={href}
            label={label}
            icon={icon}
            collapsed={collapsed}
            isActive={pathname === href || (href !== '/' && pathname.startsWith(href + '/'))}
            onNavigate={onNavigate}
          />
        ))}

        <a
          href="https://github.com/tdavidson/reporting"
          target="_blank"
          rel="noopener noreferrer"
          title={collapsed ? 'GitHub' : undefined}
          className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-xs transition-colors text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent ${
            collapsed ? 'md:justify-center md:px-0' : ''
          }`}
        >
          <Github className="h-5 w-5 shrink-0" />
          <span className={`flex-1 text-left ${collapsed ? 'md:hidden' : ''}`}>GitHub</span>
        </a>

        <a
          href="https://x.com/tdavidson"
          target="_blank"
          rel="noopener noreferrer"
          title={collapsed ? 'tdavidson' : undefined}
          className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-xs transition-colors text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent ${
            collapsed ? 'md:justify-center md:px-0' : ''
          }`}
        >
          <XIcon className="h-5 w-5 shrink-0" />
          <span className={`flex-1 text-left ${collapsed ? 'md:hidden' : ''}`}>tdavidson</span>
        </a>

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

function PublicShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { collapsed } = useSidebar()

  return (
    <>
      <header className="relative flex items-center justify-between px-4 py-3 shrink-0">
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
          <a href="https://www.hemrock.com" target="_blank" rel="noopener noreferrer">
            <img
              src="https://avatars.githubusercontent.com/u/32076122?s=200&v=4"
              alt="Hemrock"
              className="h-7 w-7 rounded object-contain"
            />
          </a>
          {!collapsed && (
            <a href="https://www.hemrock.com" target="_blank" rel="noopener noreferrer" className="font-medium text-sm text-muted-foreground tracking-tight truncate hover:text-foreground transition-colors">
              Hemrock
            </a>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="text-muted-foreground gap-2">
            <a href="https://portfolio.hemrock.com/demo" target="_blank" rel="noopener noreferrer">
              <Play className="h-4 w-4" />
              <span className="hidden sm:inline">Try the Demo</span>
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild className="text-muted-foreground gap-2">
            <a href="https://github.com/tdavidson/reporting" target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
              <span className="hidden sm:inline">View on GitHub</span>
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild className="text-muted-foreground gap-2">
            <Link href="/auth">
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">Sign in</span>
            </Link>
          </Button>
        </div>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="p-0 pt-12 w-64">
            <PublicSidebar onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>
      </header>

      <div className="flex flex-1">
        <aside
          className={`hidden md:flex flex-col shrink-0 pt-6 transition-all duration-200 ${
            collapsed ? 'w-16' : 'w-56'
          }`}
        >
          <PublicSidebar />
        </aside>

        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1">
            {children}
          </div>
          <div className="max-w-3xl">
            <AppFooter />
          </div>
        </main>
      </div>
    </>
  )
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        router.replace('/dashboard')
      } else {
        setAuthChecked(true)
      }
    })
  }, [router])

  if (!authChecked) return null

  const fathomSiteId = process.env.NEXT_PUBLIC_FATHOM_SITE_ID

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="w-full max-w-screen-xl mx-auto flex flex-col flex-1">
        <SidebarProvider>
          <PublicShell>{children}</PublicShell>
        </SidebarProvider>
      </div>
      {fathomSiteId && (
        <script src="https://cdn.usefathom.com/script.js" data-site={fathomSiteId} defer />
      )}
    </div>
  )
}
