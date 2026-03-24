import type { Metadata } from 'next'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/toaster'
import { ConfirmProvider } from '@/components/confirm-dialog'
import { Bricolage_Grotesque, Courier_Prime } from 'next/font/google'
import './globals.css'

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
})

const courierPrime = Courier_Prime({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-courier-prime',
})

const ogImageUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://portfolio.hemrock.com'}/api/og?title=Portfolio+Reporting`

export const metadata: Metadata = {
  title: {
    template: '%s | Powered by Prlx',
    default: 'Portfolio Reporting | Parallax',
  },
  description: 'Source-available portfolio reporting for venture capital firms, accelerators, and angel investors.',
  openGraph: {
    title: 'Portfolio Reporting',
    description: 'Source-available portfolio reporting for venture capital firms, accelerators, and angel investors.',
    images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    type: 'website',
    siteName: 'Analyst by PRLX',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Portfolio Reporting',
    description: 'Source-available portfolio reporting for venture capital firms, accelerators, and angel investors.',
    images: [ogImageUrl],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
     <body className={`${bricolage.className} ${courierPrime.variable}`}>
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
