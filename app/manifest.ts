import type { MetadataRoute } from 'next'
import { buildManifest, loadPwaBrand } from '@/lib/pwa'

// Served at /manifest.webmanifest, and linked from the root layout by Next.
//
// force-dynamic because the manifest carries the fund's name: baked at build time it
// would be whatever the database held when the image was built, which for a
// self-hosted deployment is usually nothing at all. loadPwaBrand caches it for five
// minutes and is invalidated by the same tags as the app shell, so this is one query
// on a cold cache, not one per install.
export const dynamic = 'force-dynamic'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return buildManifest(await loadPwaBrand())
}
