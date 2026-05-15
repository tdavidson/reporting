import { withBotId } from 'botid/next/config'

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  },
  // Include the memo-agent default schema files in the serverless function
  // bundle. Without this, `fs.readFile` calls inside `ensureDefaults` silently
  // return null in production (the YAML/MD files aren't traced), so a fresh
  // fund sees every schema marked "not yet seeded" and the schema editor loads
  // empty content. The trace is keyed `/**` so every route that imports
  // firm-schemas.ts gets the files — schemas page, agent stages, render job.
  outputFileTracingIncludes: {
    '/**': ['./lib/memo-agent/defaults/**/*'],
  },
  async headers() {
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      {
        key: 'Content-Security-Policy',
        value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.usefathom.com https://www.googletagmanager.com https://www.google-analytics.com https://assets.calendly.com; style-src 'self' 'unsafe-inline' https://assets.calendly.com; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://cdn.usefathom.com https://www.google-analytics.com https://api.github.com https://calendly.com; frame-src https://calendly.com; object-src 'none'; base-uri 'self'",
      },
    ]

    const noCacheHeaders = [
      { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Netlify-CDN-Cache-Control', value: 'no-store' },
    ]

    return [
      // Security headers for pages and API routes only — exclude _next/static
      // so Netlify CDN can serve JS/CSS chunks directly without interference.
      {
        source: '/((?!_next/static).*)',
        headers: securityHeaders,
      },
      // Prevent caching on auth and demo routes
      { source: '/auth/:path*', headers: noCacheHeaders },
      { source: '/demo', headers: noCacheHeaders },
      { source: '/api/auth/:path*', headers: noCacheHeaders },
      { source: '/api/demo/:path*', headers: noCacheHeaders },
    ]
  },
}
export default withBotId(nextConfig)
