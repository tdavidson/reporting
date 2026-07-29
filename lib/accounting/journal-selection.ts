// Selection maths for the journal's bulk-post strip. Kept out of the component so the
// interesting part — which of the visible entries a bulk action actually applies to — is
// testable without a component harness.

/** The only fields selection cares about. */
export interface SelectableEntry {
  id: string
  status: string
}

export interface SelectionSummary {
  /** Every entry on the page that can be ticked. Void entries can't. */
  selectableIds: string[]
  /** Ticked and selectable — the count the strip reports. */
  selectedIds: string[]
  /** Ticked, selectable AND still a draft — the only ones Post can act on. */
  draftIds: string[]
  /** Every selectable entry on this page is ticked (false when there are none). */
  allPageSelected: boolean
}

/**
 * What the current tick-marks mean for the entries on screen.
 *
 * `selected` may hold ids from a previous page — a stale id is simply not on this page and
 * falls out, because everything is derived from `entries` rather than from the set.
 */
export function summarizeSelection(entries: SelectableEntry[], selected: Set<string>): SelectionSummary {
  const selectable = entries.filter(e => e.status !== 'void')
  const selectedEntries = selectable.filter(e => selected.has(e.id))
  return {
    selectableIds: selectable.map(e => e.id),
    selectedIds: selectedEntries.map(e => e.id),
    draftIds: selectedEntries.filter(e => e.status === 'draft').map(e => e.id),
    allPageSelected: selectable.length > 0 && selectedEntries.length === selectable.length,
  }
}

/**
 * Split ids into request-sized batches. `bulk-post` caps one call at 500 rows (its `BATCH`),
 * and the `ids` path has no cursor to page with, so the client does the paging.
 */
export function chunkIds(ids: string[], size = 500): string[][] {
  if (size < 1) throw new Error('chunk size must be at least 1')
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

/**
 * One line for the entries bulk-post refused, bucketed by cause. The endpoint returns a
 * sentence per entry; a hundred copies of the same sentence is noise, the count is not.
 * Returns '' for nothing skipped, so callers can concatenate it unconditionally.
 */
export function describeSkipped(skipped: { id: string; reason: string }[]): string {
  if (skipped.length === 0) return ''
  const buckets: Record<string, number> = {}
  const order: string[] = []
  for (const s of skipped) {
    const cause = s.reason.startsWith('In a closed period') ? 'closed period'
      : s.reason.startsWith('Out of balance') ? 'out of balance'
      : 'not postable'
    if (buckets[cause] === undefined) { buckets[cause] = 0; order.push(cause) }
    buckets[cause] += 1
  }
  const detail = order.length === 1
    ? order[0]
    : order.map(cause => `${buckets[cause]} ${cause}`).join(', ')
  return `${skipped.length} skipped — ${detail}.`
}
