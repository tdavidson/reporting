import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://localhost:3000'

  const routes = [
    '/',
    '/pricing',
    '/contact',
    '/privacy',
    '/terms',
    '/license',
    '/dashboard-explainer',
    '/inbound-explainer',
    '/import-explainer',
    '/investments-explainer',
    '/funds-explainer',
    '/asks-explainer',
    '/notes-explainer',
    '/interactions-explainer',
    '/letters-explainer',
    '/settings-explainer',
    '/support-explainer',
  ]

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '/' ? 'weekly' : 'monthly',
    priority: route === '/' ? 1.0 : route === '/pricing' ? 0.8 : 0.6,
  }))
}
