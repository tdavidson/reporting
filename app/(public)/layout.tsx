'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { Github, LogIn, Play, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppFooter } from '@/components/app-footer'
import { APP_VERSION } from '@/lib/version'

function HemrockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M13 14L17 9L22 18H2.84444C2.46441 18 2.2233 17.5928 2.40603 17.2596L10.0509 3.31896C10.2429 2.96885 10.7476 2.97394 10.9325 3.32786L15.122 11.3476" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
      <header className="relative flex items-center justify-between px-6 md:px-8 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <a href="https://www.hemrock.com" target="_blank" rel="noopener noreferrer" aria-label="Hemrock">
            <HemrockIcon className="h-7 w-7 text-foreground" />
          </a>
          <a href="https://www.hemrock.com" target="_blank" rel="noopener noreferrer" className="font-medium text-sm text-muted-foreground tracking-tight truncate hover:text-foreground transition-colors">
            Hemrock
          </a>
          <span className="hidden md:inline-block text-caption text-muted-foreground border rounded px-1.5 py-0.5">v{APP_VERSION}</span>
        </div>

        {/* One primary action. The demo is the thing a first-time visitor should
            do; GitHub and sign-in are secondary and read as such. */}
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground gap-2">
            <a href="https://github.com/tdavidson/reporting" target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
              {starCount != null && starCount >= 10 && (
                <span className="inline-flex items-center gap-0.5 text-xs">
                  <Star className="h-3 w-3 fill-current" />
                  {starCount}
                </span>
              )}
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground gap-2">
            <Link href="/auth">
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">Sign in</span>
            </Link>
          </Button>
          <Button size="sm" asChild className="gap-2 bg-brand text-brand-foreground hover:bg-brand-800 ml-1">
            <a href="https://portfolio.hemrock.com/demo" target="_blank" rel="noopener noreferrer">
              <Play className="h-4 w-4" />
              Try the Demo
            </a>
          </Button>
        </div>
      </header>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1">
          {children}
        </div>
        <AppFooter social />
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
      <div className="w-full max-w-[1100px] mx-auto flex flex-col flex-1">
        <PublicShell>{children}</PublicShell>
      </div>
      {fathomSiteId && (
        <script src="https://cdn.usefathom.com/script.js" data-site={fathomSiteId} defer />
      )}
    </div>
  )
}
