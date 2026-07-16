// Turn a request path into a registry key: '/api/deals/abc-123' → 'api/deals/[id]'.
//
// Used by the middleware to find a route's access decision before the route runs. Kept dependency-
// free so it can live in the edge bundle.

import { ROUTE_DOMAINS, UNGATED_ROUTES } from './route-domains'

interface Compiled {
  key: string
  segments: string[]
  /** Literal segments rank above dynamic ones, so a fixed path wins over a [id] that also fits. */
  specificity: number
}

const compiled: Compiled[] = [...Object.keys(ROUTE_DOMAINS), ...Object.keys(UNGATED_ROUTES)]
  .map(key => {
    const segments = key.split('/')
    return {
      key,
      segments,
      specificity: segments.reduce((n, s) => n + (isDynamic(s) ? 0 : 1), 0),
    }
  })
  // Most literal segments first: 'api/lps/snapshots/from-live' must beat 'api/lps/snapshots/[id]'.
  .sort((a, b) => b.specificity - a.specificity)

function isDynamic(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']')
}

/**
 * The registry key for a request path, or null when nothing matches.
 *
 * Null is a real answer, not an error: it means this path is not an app API route the registry
 * knows about. The caller decides what to do with that — the middleware denies, because an
 * unrecognised API path is an unanswered question rather than an open door.
 */
export function matchRoute(pathname: string): string | null {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/')

  for (const route of compiled) {
    if (route.segments.length !== parts.length) continue
    let ok = true
    for (let i = 0; i < parts.length; i++) {
      const seg = route.segments[i]
      if (isDynamic(seg)) {
        // A dynamic segment matches exactly one non-empty segment.
        if (!parts[i]) { ok = false; break }
      } else if (seg !== parts[i]) {
        ok = false
        break
      }
    }
    if (ok) return route.key
  }
  return null
}
