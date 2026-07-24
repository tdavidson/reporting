'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { Github, LogIn, Play, Monitor, Sun, Moon, Star } from 'lucide-react'

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function HemrockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M13 14L17 9L22 18H2.84444C2.46441 18 2.2233 17.5928 2.40603 17.2596L10.0509 3.31896C10.2429 2.96885 10.7476 2.97394 10.9325 3.32786L15.122 11.3476" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
import { Button } from '@/components/ui/button'
import { useTheme } from 'next-themes'
import { AppFooter } from '@/components/app-footer'
import { APP_VERSION } from '@/lib/version'

const THEME_CYCLE = ['system', 'light', 'dark'] as const
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon }
const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' }

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const current = (THEME_CYCLE.includes(theme as typeof THEME_CYCLE[number]) ? theme : 'system') as typeof THEME_CYCLE[number]
  const Icon = mounted ? THEME_ICONS[current] : Monitor
  const label = mounted ? THEME_LABELS[current] : 'System'
  return (
    <Button
      variant="outline" size="sm" title={label}
      className="text-muted-foreground"
      onClick={() => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length])}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}

function PublicShell({ children }: { children: React.ReactNode }) {
  const [starCount, setStarCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/github-stars')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.stars != null) setStarCount(d.stars) })
      .catch(() => {})
  }, [])

  return (
    <>
      <header className="relative flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <a href="https://www.hemrock.com" target="_blank" rel="noopener noreferrer" aria-label="Hemrock">
            <HemrockIcon className="h-7 w-7 text-foreground" />
          </a>
          <a href="https://www.hemrock.com" target="_blank" rel="noopener noreferrer" className="font-medium text-sm text-muted-foreground tracking-tight truncate hover:text-foreground transition-colors">
            Hemrock
          </a>
          <span className="hidden md:inline-block text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 px-1.5 py-0.5 rounded">v{APP_VERSION}</span>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggleButton />
          <Button variant="outline" size="sm" asChild className="text-muted-foreground gap-2 hidden sm:inline-flex">
            <a href="https://portfolio.hemrock.com/demo" target="_blank" rel="noopener noreferrer">
              <Play className="h-4 w-4" />
              Try the Demo
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild className="text-muted-foreground gap-2">
            <a href="https://github.com/tdavidson/reporting" target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
              {starCount != null && starCount >= 10 && (
                <span className="inline-flex items-center gap-0.5 text-xs">
                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  {starCount}
                </span>
              )}
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild className="text-muted-foreground gap-2 hidden sm:inline-flex">
            <a href="https://x.com/tdavidson" target="_blank" rel="noopener noreferrer" aria-label="tdavidson">
              <XIcon className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild className="text-muted-foreground gap-2">
            <Link href="/auth">
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">Sign in</span>
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1">
          {children}
        </div>
        <div className="max-w-3xl">
          <AppFooter />
        </div>
      </main>
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
        <PublicShell>{children}</PublicShell>
      </div>
      {fathomSiteId && (
        <script src="https://cdn.usefathom.com/script.js" data-site={fathomSiteId} defer />
      )}
    </div>
  )
}
