import { withBotId } from 'botid/next/config'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack infers the workspace root from the nearest lockfile, and a stray package-lock.json
  // in a parent directory (a developer's ~/Documents, say) makes it guess wrong and warn on every
  // build. The root is this directory; say so.
  turbopack: { root: import.meta.dirname },
  // Both were `experimental.*` on Next 14 and are top-level on 16. `serverComponentsExternalPackages`
  // was also renamed to `serverExternalPackages`.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // Include the memo-agent default schema files in the serverless function
  // bundle. Without this, `fs.readFile` calls inside `ensureDefaults` silently
  // return null in production (the YAML/MD files aren't traced), so a fresh
  // fund sees every schema marked "not yet seeded" and the schema editor loads
  // empty content. The trace is keyed `/**` so every route that imports
  // firm-schemas.ts gets the files — schemas page, agent stages, render job.
  outputFileTracingIncludes: {
    '/**': ['./lib/memo-agent/defaults/**/*'],
  },
  // OAuth discovery lives at /.well-known/*, but Next's app router will not route
  // a literal dot-prefixed directory — so the well-known paths are rewritten onto
  // real routes under /api/oauth/metadata/.
  //
  // The path-suffixed variants matter: RFC 9728 says a client MAY probe
  // /.well-known/oauth-protected-resource/<resource-path>, and Claude does exactly
  // that for /api/mcp. Serving only the bare path would leave discovery failing
  // for no visible reason.
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/metadata/authorization-server',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/oauth/metadata/authorization-server',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/metadata/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/oauth/metadata/protected-resource',
      },
    ]
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
        value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.usefathom.com https://www.googletagmanager.com https://www.google-analytics.com https://assets.calendly.com; style-src 'self' 'unsafe-inline' https://assets.calendly.com; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://cdn.usefathom.com https://www.google-analytics.com https://api.github.com https://calendly.com; frame-src https://calendly.com https://*.supabase.co https://*.supabase.in; object-src 'none'; base-uri 'self'",
      },
    ]

    const noCacheHeaders = [
      { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
    ]

    return [
      // Security headers for pages and API routes only — exclude _next/static so the CDN can
      // serve immutable JS/CSS chunks straight from cache without these headers in the way.
      {
        source: '/((?!_next/static).*)',
        headers: securityHeaders,
      },
      // Prevent caching on auth and demo routes. /demo matters most: it is a client component
      // with no dynamic server API, so nothing else stops it being prerendered and served
      // stale — and a stale demo page is one that never runs its sign-in.
      { source: '/auth/:path*', headers: noCacheHeaders },
      { source: '/demo', headers: noCacheHeaders },
      { source: '/api/auth/:path*', headers: noCacheHeaders },
      { source: '/api/demo/:path*', headers: noCacheHeaders },
    ]
  },
}
export default withBotId(nextConfig)
