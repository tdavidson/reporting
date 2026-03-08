'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Github, LogIn, Play } from 'lucide-react'

const screenshots = [
  { src: '/screenshots/dashboard.png', label: 'Portfolio Dashboard' },
  { src: '/screenshots/company.png', label: 'Company Detail' },
  { src: '/screenshots/review.png', label: 'Review Queue' },
  { src: '/screenshots/inbound.png', label: 'Inbound Emails' },
  { src: '/screenshots/email-detail.png', label: 'Email Detail' },
  { src: '/screenshots/import.png', label: 'Import' },
  { src: '/screenshots/asks.png', label: 'Asks' },
  { src: '/screenshots/notes.png', label: 'Notes' },
  { src: '/screenshots/settings.png', label: 'Settings' },
]

export default function LandingPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)

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

  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % screenshots.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [paused])

  if (!authChecked) return null

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8 relative">
        <a href="/auth" className="absolute top-4 right-4 text-sm text-muted-foreground hover:text-foreground sm:right-6 lg:right-8 inline-flex items-center gap-1.5">
          <LogIn className="h-4 w-4" />
          Sign in
        </a>
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-12 max-w-3xl mx-auto">
          <img
            src="https://avatars.githubusercontent.com/u/32076122?s=200&v=4"
            alt="Hemrock"
            width={64}
            height={64}
            className="rounded-lg mb-6"
          />
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl mb-2">
            Fund Portfolio Reporting
          </h1>
          <p className="text-sm text-muted-foreground mb-4">
            Built by{' '}
            <a href="https://www.hemrock.com/about" className="underline hover:text-foreground">
              Taylor Davidson
            </a>{' '}
            of{' '}
            <a href="https://www.hemrock.com" className="underline hover:text-foreground">
              Hemrock
            </a>
          </p>
          <p className="text-base text-muted-foreground max-w-2xl">
            A portfolio reporting tool for venture capital funds. Portfolio companies send
            their quarterly updates in any format — PDF, Excel, PowerPoint, or plain text —
            and AI automatically identifies the company, extracts the metrics you&apos;ve
            configured, stores everything as time-series data, and creates an analysis of
            new updates and trends. The dashboard gives you a live view of your portfolio
            with fund-level, portfolio-level, and individual company details.
          </p>
        </div>

        {/* CTA */}
        <div className="flex justify-center gap-3 mb-12 max-w-3xl mx-auto">
          <Button asChild size="lg">
            <a href="https://portfolio.hemrock.com/demo" target="_blank" rel="noopener noreferrer" className="gap-2">
              <Play className="h-4 w-4" />
              Try the Demo
            </a>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a href="https://github.com/tdavidson/reporting" className="gap-2">
              <Github className="h-4 w-4" />
              View on GitHub
            </a>
          </Button>
        </div>

        {/* Screenshot Carousel */}
        <div
          className="relative mb-12"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
            <Image
              src={screenshots[current].src}
              alt={screenshots[current].label}
              fill
              className="object-contain"
              priority={current === 0}
            />
          </div>
          <p className="text-center text-sm text-muted-foreground mt-2">
            {screenshots[current].label}
          </p>

          <button
            onClick={() => setCurrent((prev) => (prev - 1 + screenshots.length) % screenshots.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1.5 shadow hover:bg-background"
            aria-label="Previous screenshot"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setCurrent((prev) => (prev + 1) % screenshots.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1.5 shadow hover:bg-background"
            aria-label="Next screenshot"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="flex justify-center gap-1.5 mt-3">
            {screenshots.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`h-2 w-2 rounded-full transition-colors ${
                  i === current ? 'bg-foreground' : 'bg-muted-foreground/30'
                }`}
                aria-label={`Go to screenshot ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Pricing & License */}
        <section className="mb-16">
          <h2 className="text-xl font-semibold mb-2 text-center">Pricing</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">
            Source-available under a single-fund free use license. See the full{' '}
            <a href="https://github.com/tdavidson/reporting/blob/main/LICENSE" className="underline hover:text-foreground">
              license on GitHub
            </a>
            .
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border p-6 flex flex-col">
              <h3 className="font-semibold mb-1">Self-Hosted</h3>
              <p className="text-2xl font-bold mb-1">Free</p>
              <p className="text-xs text-muted-foreground mb-3">Run on your own servers</p>
              <ul className="text-sm text-muted-foreground space-y-1.5 mb-4 flex-1">
                <li>Single fund management company</li>
                <li>All your funds, SPVs, and team members</li>
                <li>Deploy on your own infrastructure</li>
                <li>Modify and use on your own domain</li>
              </ul>
              <Button variant="outline" size="sm" asChild className="w-full">
                <a href="https://github.com/tdavidson/reporting" className="gap-2">
                  <Github className="h-4 w-4" />
                  View on GitHub
                </a>
              </Button>
            </div>
            <div className="rounded-lg border p-6 flex flex-col">
              <h3 className="font-semibold mb-1">Managed</h3>
              <p className="text-2xl font-bold mb-1">Custom</p>
              <p className="text-xs text-muted-foreground mb-3">One-time setup cost</p>
              <ul className="text-sm text-muted-foreground space-y-1.5 mb-4 flex-1">
                <li>Deployed on your infrastructure and accounts</li>
                <li>Setup and onboarding included</li>
                <li>Ongoing support available</li>
              </ul>
              <Button variant="outline" size="sm" asChild className="w-full">
                <a href="https://www.hemrock.com/contact">Contact Taylor</a>
              </Button>
            </div>
            <div className="rounded-lg border p-6 flex flex-col">
              <h3 className="font-semibold mb-1">Commercial</h3>
              <p className="text-2xl font-bold mb-1">Licensed</p>
              <p className="text-xs text-muted-foreground mb-3">Deploy to your customers</p>
              <ul className="text-sm text-muted-foreground space-y-1.5 mb-4 flex-1">
                <li>Fund administrators and outsourced CFOs</li>
                <li>Consultants and service providers</li>
                <li>Use across multiple clients</li>
              </ul>
              <Button variant="outline" size="sm" asChild className="w-full">
                <a href="https://www.hemrock.com/contact">Contact Taylor</a>
              </Button>
            </div>
          </div>
        </section>

        {/* About */}
        <section className="mb-16 max-w-3xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <img
              src="https://www.hemrock.com/_next/image?url=%2Fassets%2Ftdavidson.jpg&w=128&q=75"
              alt="Taylor Davidson"
              width={96}
              height={96}
              className="rounded-lg shrink-0"
            />
            <div>
              <h2 className="text-xl font-semibold mb-2">Taylor Davidson</h2>
              <p className="text-sm text-muted-foreground">
                Taylor Davidson helps entrepreneurs and investors create and use financial
                models for business decisions through his template financial models and
                strategic advisory services at{' '}
                <a href="https://www.hemrock.com" className="underline hover:text-foreground">
                  Hemrock
                </a>{' '}
                (formerly Foresight). Fractional Chief Financial Officer for{' '}
                <a href="https://laconiacapitalgroup.com" className="underline hover:text-foreground">
                  Laconia Capital Group
                </a>
                . Learn more and contact at{' '}
                <a href="https://www.hemrock.com/about" className="underline hover:text-foreground">
                  About
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
