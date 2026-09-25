import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/site-links'

/**
 * The app had no robots file, so crawlers had nothing to go on but links.
 * Everything behind sign-in redirects to /auth, which renders noindex, so the
 * disallow list stays short: only the API, which has nothing to render. The host is the
 * deployment's own (siteOrigin), never a hardcoded one.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = siteOrigin()
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
