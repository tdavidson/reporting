import type { Metadata } from 'next'
import { PRODUCT_NAME, siteOrigin } from '@/lib/site-links'

const BASE_URL = siteOrigin()

export function ogMetadata(opts: {
  title: string
  description: string
  subtitle?: string
  /**
   * Site-relative path of the page, when it should be indexed. Emits an
   * absolute canonical so `?ref=producthunt` and friends fold into the clean
   * URL instead of being filed as duplicates.
   */
  path?: string
}): Metadata {
  const ogUrl = new URL('/api/og', BASE_URL)
  ogUrl.searchParams.set('title', opts.title)
  if (opts.subtitle) ogUrl.searchParams.set('subtitle', opts.subtitle)

  return {
    title: opts.title,
    description: opts.description,
    ...(opts.path ? { alternates: { canonical: new URL(opts.path, BASE_URL).toString() } } : {}),
    openGraph: {
      title: opts.title,
      description: opts.description,
      images: [{ url: ogUrl.toString(), width: 1200, height: 630, alt: opts.title }],
      type: 'website',
      siteName: PRODUCT_NAME,
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
      images: [ogUrl.toString()],
    },
  }
}
