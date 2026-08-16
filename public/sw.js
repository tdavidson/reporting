/*
 * Service worker. Deliberately, almost aggressively minimal.
 *
 * A previous deployment shipped a worker that cached documents, and the fix was a
 * script in the root layout that unregistered every worker it found — because once a
 * worker serves a stale HTML shell, the user has no way to get a fresh one and no
 * idea why the app is wrong. That script is gone now; this file is what replaced it,
 * and it is built so the same failure cannot recur:
 *
 *   - No document is ever cached. Navigations always hit the network; the only
 *     stored HTML is the offline fallback, which is served exclusively when the
 *     network throws.
 *   - No API response is ever cached. Beyond staleness, this is financial data on a
 *     device that may be shared or handed on, and a cached response outlives the
 *     session that was allowed to see it.
 *   - The only things stored are Next's content-hashed chunks under /_next/static/,
 *     which cannot go stale: a new build changes the URL.
 *
 * So the worst this worker can do to a signed-in user is hand them a chunk they had
 * already downloaded.
 *
 * The `?v=` on the registration URL is the app version. Changing it is what makes the
 * browser treat this as a new worker on release, and it keys the cache so the
 * previous build's chunks are dropped on activate. See app/layout.tsx.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const STATIC_CACHE = `static-${VERSION}`
const OFFLINE_URL = '/offline'

/** Paths this worker must never come between the app and the network. */
const BYPASS = ['/api/', '/auth', '/oauth', '/.well-known/']

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      // `cache: 'reload'` so installing a new worker refetches the fallback rather
      // than promoting whatever the HTTP cache happens to be holding.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Drop every cache from another version — including any left by the worker
      // this one replaced.
      const names = await caches.keys()
      await Promise.all(names.filter(name => name !== STATIC_CACHE).map(name => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (BYPASS.some(prefix => url.pathname.startsWith(prefix))) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkOnlyWithOfflineFallback(request))
  }

  // Everything else falls through to the network untouched.
})

/** Safe only for immutable, content-addressed URLs. */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit

  const response = await fetch(request)
  if (response && response.ok) cache.put(request, response.clone())
  return response
}

/** Never serves a cached document — the fallback is reached only when fetch throws. */
async function networkOnlyWithOfflineFallback(request) {
  try {
    return await fetch(request)
  } catch (err) {
    const cache = await caches.open(STATIC_CACHE)
    const fallback = await cache.match(OFFLINE_URL)
    if (fallback) return fallback
    throw err
  }
}
