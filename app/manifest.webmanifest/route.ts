import { buildManifest, loadPwaBrand, manifestResponse } from '@/lib/pwa'

// The manager app's manifest, linked from app/layout.tsx.
//
// A route handler, NOT Next's `app/manifest.ts` file convention, even though both
// answer on this same URL. The convention registers file-based metadata, and
// `mergeStaticMetadata` applies that AFTER the normal field merge
// (next/dist/lib/metadata/resolve-metadata.js) — so it overwrites `metadata.manifest`
// in every child layout. With it in place the LP portal could not link its own
// manifest no matter what it declared, and an LP installing from the portal got the
// manager app. A plain route imposes nothing on the layout tree, so
// app/portal/layout.tsx can override the link.
//
// force-dynamic because the manifest carries the fund's name: baked at build time it
// would be whatever the database held when the image was built, which for a
// self-hosted deployment is usually nothing at all. loadPwaBrand caches it for five
// minutes and is invalidated by the same tags as the app shell, so this is one query
// on a cold cache, not one per install.
export const dynamic = 'force-dynamic'

export async function GET() {
  return manifestResponse(buildManifest(await loadPwaBrand()))
}
