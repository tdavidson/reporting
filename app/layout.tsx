import type { Metadata } from 'next'
import Script from 'next/script'
import { Hanken_Grotesk, Plus_Jakarta_Sans, Inter, Newsreader, Source_Serif_4, Libre_Caslon_Display } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/toaster'
import { ConfirmProvider } from '@/components/confirm-dialog'
import './globals.css'

// Inter is the default UI face — the Hemrock brand guide's typeface, and what
// hemrock.com ships. globals.css points --font-sans at it.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

// Source Serif 4 is the display face, behind --font-display. Variable weight and
// drawn for screen, so one face covers a 68px marketing hero and a 20px report
// cover. Low contrast and sturdy — it shares a humanist skeleton with Inter, so
// the pairing reads as chosen rather than borrowed. Absent from FONT_OPTIONS
// because that list drives --font-sans, the body font: a serif there would land
// on every dense financial table. A per-fund display face writes --font-display
// via its own axis (see DESIGN.md).
const sourceSerif = Source_Serif_4({ subsets: ['latin'], variable: '--font-source-serif', display: 'swap' })

// Curated per-fund UI font options. Loaded as CSS variables so the per-fund theme
// can opt in via --font-sans; unset, --font-sans stays on Inter.
//
// preload:false on every optional face — only one fund in a deployment uses any
// given one, so preloading all four would make every page pay for fonts it will
// never reference. They are fetched on demand when a theme points at them.
const hankenGrotesk = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap', preload: false })
const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap', preload: false })

// Alternate display faces a fund may pick for its reports (DISPLAY_FONT_OPTIONS).
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', display: 'swap', preload: false })
const libreCaslon = Libre_Caslon_Display({ subsets: ['latin'], weight: '400', variable: '--font-libre-caslon', display: 'swap', preload: false })

const ogImageUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://portfolio.hemrock.com'}/api/og?title=Portfolio+Reporting`

export const metadata: Metadata = {
  title: {
    template: '%s | Powered by Hemrock',
    default: 'Portfolio Reporting | Powered by Hemrock',
  },
  description: 'Open source portfolio reporting for venture capital firms, accelerators, and angel investors.',
  openGraph: {
    title: 'Portfolio Reporting | Analyst by Hemrock',
    description: 'Open source portfolio reporting for venture capital firms, accelerators, and angel investors.',
    images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    type: 'website',
    siteName: 'Analyst by Hemrock',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Portfolio Reporting | Analyst by Hemrock',
    description: 'Open source portfolio reporting for venture capital firms, accelerators, and angel investors.',
    images: [ogImageUrl],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${newsreader.variable} ${sourceSerif.variable} ${libreCaslon.variable} ${hankenGrotesk.variable} ${plusJakarta.variable}`}>
      <body className="font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="portfolio-theme"
        >
          <ConfirmProvider>
            {children}
          </ConfirmProvider>
          <Toaster />
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
        {/* Unregister any stale service workers from prior deployments */}
        <Script id="sw-cleanup" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              regs.forEach(function(r) { r.unregister(); });
            });
          }
        `}</Script>
      </body>
    </html>
  )
}
