'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { StyleAnchorsLibrary } from './library'

type Confidence = 'unavailable' | 'preliminary' | 'reliable' | 'robust'

// Mirrors getSynthesisConfidence() server-side: 0 → unavailable, 1-2 →
// preliminary, 3-7 → reliable, 8+ → robust.
function confidenceFor(count: number): Confidence {
  if (count <= 0) return 'unavailable'
  if (count <= 2) return 'preliminary'
  if (count <= 7) return 'reliable'
  return 'robust'
}

/**
 * Inline (settings-page) variant of the style-anchors library — fetches the
 * fund's anchors client-side and renders the existing library embedded.
 */
export function StyleAnchorsInline() {
  const [anchors, setAnchors] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/firm/style-anchors')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(data => setAnchors(Array.isArray(data) ? data : []))
      .catch(() => setError('Could not load example memos.'))
  }, [])

  if (error) return <div className="text-sm text-destructive">{error}</div>
  if (anchors === null) return <div className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>

  return <StyleAnchorsLibrary initialAnchors={anchors} initialConfidence={confidenceFor(anchors.length)} embedded />
}
