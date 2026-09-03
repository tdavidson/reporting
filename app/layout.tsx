import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { headers } from 'next/headers'
import { NONCE_HEADER } from '@/lib/security/csp'
import { Hanken_Grotesk, Plus_Jakarta_Sans, Inter, Newsreader, Source_Serif_4, Libre_Caslon_Display } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { BotIdClient } from 'botid/client'
import { BOTID_PROTECTED_ROUTES } from '@/lib/botid-routes'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/toaster'
import { ConfirmProvider } from '@/components/confirm-dialog'
import { APP_VERSION } from '@/lib/version'
import { SURFACE_DARK_HEX, SURFACE_LIGHT_HEX, appleTouchIcons } from '@/lib/pwa'
import './globals.css'

// Inter is the default UI face — the Hemrock brand guide's typeface, and what
// hemrock.com ships. globals.css points --font-sans at it.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

// Curated per-fund UI font options. Loaded as CSS variables so the per-fund theme
// can opt in via --font-sans; unset, --font-sans stays on Inter.
//
// preload:false on every optional face — only one fund in a deployment uses any
// given one, so preloading all four would make every page pay for fonts it will
// never reference. They are fetched on demand when a theme points at them.
const hankenGrotesk = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap', preload: false })
const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap', preload: false })

// Serif display faces a fund may pick for its headings and reports
// (DISPLAY_FONT_OPTIONS). None load by default — --font-display is Inter until a
// theme points it at one of these, so the app ships with no serif at all while
// keeping the axis wired for anyone who wants one.
const sourceSerif = Source_Serif_4({ subsets: ['latin'], variable: '--font-source-serif', display: 'swap', preload: false })
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', display: 'swap', preload: false })
const libreCaslon = Libre_Caslon_Display({ subsets: ['latin'], weight: '400', variable: '--font-libre-caslon', display: 'swap', preload: false })

const ogImageUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://portfolio.hemrock.com'}/api/og?title=Portfolio+Reporting`

// Interpolated into an inline <script> below, so it is stripped to the characters a
// version can legitimately contain rather than trusted for being ours.
const SW_VERSION = APP_VERSION.replace(/[^\w.-]/g, '') || 'dev'

export const metadata: Metadata = {
  title: {
    template: '%s | Powered by Hemrock',
    default: 'Portfolio Reporting | Powered by Hemrock',
  },
  description: 'Open source fund operations for venture capital firms, accelerators, and angel investors.',
  openGraph: {
    title: 'Portfolio Reporting | Analyst by Hemrock',
    description: 'Open source fund operations for venture capital firms, accelerators, and angel investors.',
    images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    type: 'website',
    siteName: 'Analyst by Hemrock',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Portfolio Reporting | Analyst by Hemrock',
    description: 'Open source fund operations for venture capital firms, accelerators, and angel investors.',
    images: [ogImageUrl],
  },
  // Linked as a field rather than through Next's app/manifest.ts file convention: the
  // convention overrides `metadata.manifest` in every child layout, which left the LP
  // portal unable to link its own. app/manifest.webmanifest/route.ts explains it in
  // full; app/portal/layout.tsx is the override this enables.
  manifest: '/manifest.webmanifest',
  // The home-screen icon. app/icon.tsx stays the 32px favicon; this is the same mark
  // drawn large and in the fund's accent. iOS prefers this over the manifest's icons,
  // so app/portal/layout.tsx overrides it with the inverted variant — without that,
  // an LP's home screen would show the manager icon whatever the manifest said.
  //
  // One link PER SIZE rather than a single 180. iOS does not resample an icon well,
  // and 180 is only right for an iPhone: an iPad wants 152 or 167 and was scaling the
  // one it was given, which is a large part of why the installed icon looked soft.
  icons: { apple: appleTouchIcons('app') },
  appleWebApp: {
    // Older iOS needs this to launch without Safari chrome; iOS 17+ reads
    // `display: standalone` off the manifest instead. Both are cheap to keep.
    capable: true,
    statusBarStyle: 'default',
    // No `title` on purpose. Setting one here would emit apple-mobile-web-app-title,
    // which OVERRIDES the manifest's short_name — pinning every deployment to our
    // name and undoing the per-fund branding in lib/pwa.ts.
  },
}

export const viewport: Viewport = {
  // Next's defaults, restated because declaring `viewport` at all replaces them.
  width: 'device-width',
  initialScale: 1,
  // Deliberately no `maximumScale` / `userScalable: false`: pinch-zoom on a table of
  // figures is the whole point of reading this on a phone.
  //
  // Also deliberately no `viewportFit: 'cover'`. Edge-to-edge means paying back the
  // notch and home-indicator insets by hand across the app shell, and getting it
  // wrong puts content under the status bar. The default keeps the app inside the
  // safe area and letterboxes with `theme_color`, which for a data app is the right
  // trade.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: SURFACE_LIGHT_HEX },
    { media: '(prefers-color-scheme: dark)', color: SURFACE_DARK_HEX },
  ],
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Set by proxy.ts per response. Absent on paths the proxy does not run on (none that render
  // this layout), in which case the script goes out un-nonced and the report-only policy records
  // it — which is the right outcome for a path that was supposed to be covered.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined

  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${newsreader.variable} ${sourceSerif.variable} ${libreCaslon.variable} ${hankenGrotesk.variable} ${plusJakarta.variable}`}>
      <head>
        {/* BotId's client half. It must be mounted HERE and not in instrumentation-client.ts:
            that file is a Next 15.3+ entry point and this app is on 14, so it was compiled by
            nothing and loaded by nothing — silently, with the only symptom being that every
            visitor to /demo was classified as a bot. Move it back only when Next is upgraded.
            Renders an inline <script>, which the CSP in next.config.mjs allows via
            'unsafe-inline'; the challenge itself is same-origin through withBotId's rewrites. */}
        <BotIdClient protect={BOTID_PROTECTED_ROUTES} />
      </head>
      <body className="font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="portfolio-theme"
          nonce={nonce}
        >
          <ConfirmProvider>
            {children}
          </ConfirmProvider>
          <Toaster />
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
        {/* Service worker — public/sw.js, which explains what it will and won't cache.
            This replaced a script that unregistered every worker it found, after an
            earlier one cached HTML and stranded people on a stale build.

            `?v=` is the app version: a release changes the URL, which is what makes
            the browser install the new worker and lets it key its cache per version.

            Registers immediately rather than from a `load` listener. afterInteractive
            runs after hydration, which is regularly after `load` has already fired —
            and a listener added then never fires at all, so the worker would simply
            never register. afterInteractive is already the "page is usable" point
            that a load handler would have been waiting for.

            NEXT_PUBLIC_DISABLE_SW=true is the escape hatch that incident earned. It
            does not merely skip registration — it unregisters whatever is already
            installed, so setting it and redeploying is a complete way out without
            asking anyone to clear site data. */}
        <Script id="sw-register" strategy="afterInteractive" nonce={nonce}>{
          process.env.NEXT_PUBLIC_DISABLE_SW === 'true'
            ? `if ('serviceWorker' in navigator) {
                 navigator.serviceWorker.getRegistrations().then(function (regs) {
                   regs.forEach(function (r) { r.unregister(); });
                 });
               }`
            : `if ('serviceWorker' in navigator) {
                 navigator.serviceWorker.register('/sw.js?v=${SW_VERSION}').catch(function () {});
               }`
        }</Script>
      </body>
    </html>
  )
}
