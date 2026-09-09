import type { MetadataRoute } from 'next'

/**
 * The app had no robots file, so crawlers had nothing to go on but links.
 * Everything behind sign-in redirects to /auth, which renders noindex, so the
 * disallow list stays short: only the API, which has nothing to render.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://portfolio.hemrock.com'
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
